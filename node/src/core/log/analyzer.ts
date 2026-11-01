/**
 * Log parsing engine — behavioural port of
 * ``backend/src/ala/services/log_analyzer.py``.
 *
 * Three formats are recognised (Android logcat, generic timestamped text and
 * unknown fallback) and both eager (``parseLog``) and lazy
 * (``parseLogIter`` / ``streamFile``) access is supported. Local file access is
 * sandboxed via ``validatePath`` and archives are handled by ``extractTextFiles``.
 */
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { extractTextFiles, isLogName } from './archives.ts'
import { createLogFilter } from './filter.ts'
import { validatePath } from './paths.ts'
import { readZipEntries, readZipMember } from './zip.ts'
import type {
  FileRef,
  LogEntry,
  LogFilters,
  LogFormat,
  LogStatistics,
  ParseResult,
} from './types.ts'

/**
 * ``^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3,6})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):+\s+(.*)$``
 *
 * ``[^\n]`` stands in for Python's ``.``, which only excludes ``\n`` — JS ``.``
 * also excludes ``\r``, and CR-only line endings must still parse.
 */
const ANDROID_PATTERN =
  /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3,6})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]+):+\s+([^\n]*)$/

/**
 * Generic timestamped text, e.g. ``[2024-01-15 10:30:45] ERROR: boom``.
 * Python compiles it with ``re.IGNORECASE``.
 */
const GENERIC_PATTERN =
  /^(?:\[)?(\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d{3})?)\]?\s*(?:\[)?([A-Z]+|VERBOSE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\]?:?\s*(?:-\s*)?([^\n]+)$/i

/** Read size for the streaming line reader. */
const CHUNK_SIZE = 64 * 1024

/** Strip trailing CR/LF, mirroring ``raw_line.rstrip("\n\r")``. */
function stripLineEnding(line: string): string {
  let end = line.length
  while (end > 0 && (line[end - 1] === '\n' || line[end - 1] === '\r')) end -= 1
  return end === line.length ? line : line.slice(0, end)
}

/**
 * Split `text` into lines using Python text-mode universal-newline semantics
 * (``\r\n``, ``\r`` and ``\n`` all terminate a line; a trailing newline does not
 * produce an extra empty line).
 */
function* splitTextLines(text: string): Generator<string> {
  let start = 0
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code === 0x0a) {
      yield text.slice(start, index)
      index += 1
      start = index
    } else if (code === 0x0d) {
      yield text.slice(start, index)
      if (index + 1 < text.length && text.charCodeAt(index + 1) === 0x0a) index += 1
      index += 1
      start = index
    } else {
      index += 1
    }
  }
  if (start < text.length) yield text.slice(start)
}

/**
 * Yield UTF-8 lines from `filePath` in 64 KiB chunks.
 *
 * The descriptor is closed when the generator is exhausted *or* abandoned
 * (``for...of`` + ``break``), so callers can sample the head of a huge file.
 */
function* readFileLines(filePath: string): Generator<string> {
  const descriptor = fs.openSync(filePath, 'r')
  const decoder = new TextDecoder('utf-8')
  const buffer = Buffer.allocUnsafe(CHUNK_SIZE)
  let pending = ''
  let skipLeadingLf = false
  try {
    for (;;) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      let text = decoder.decode(buffer.subarray(0, bytesRead), { stream: true })
      if (skipLeadingLf) {
        if (text.startsWith('\n')) text = text.slice(1)
        skipLeadingLf = false
      }
      pending += text

      let start = 0
      let index = 0
      while (index < pending.length) {
        const code = pending.charCodeAt(index)
        if (code === 0x0a) {
          yield pending.slice(start, index)
          index += 1
          start = index
        } else if (code === 0x0d) {
          yield pending.slice(start, index)
          if (index + 1 < pending.length) {
            if (pending.charCodeAt(index + 1) === 0x0a) index += 1
            index += 1
            start = index
          } else {
            // A CR at a chunk boundary may be the first half of CRLF.
            skipLeadingLf = true
            index = pending.length
            start = pending.length
          }
        } else {
          index += 1
        }
      }
      pending = pending.slice(start)
    }

    pending += decoder.decode()
    if (skipLeadingLf) {
      if (pending.startsWith('\n')) pending = pending.slice(1)
      skipLeadingLf = false
    }
    if (pending.length > 0) yield pending
  } finally {
    fs.closeSync(descriptor)
  }
}

export class LogAnalyzer {
  /** Detect the log format from the first 10 non-empty lines. */
  detectLogFormat(content: string): LogFormat {
    const sample = content
      .split('\n')
      .filter((line) => line.trim() !== '')
      .slice(0, 10)
    if (sample.length === 0) return 'unknown'

    let androidMatches = 0
    let genericMatches = 0
    for (const line of sample) {
      const stripped = line.trim()
      if (ANDROID_PATTERN.test(stripped)) androidMatches += 1
      if (GENERIC_PATTERN.test(stripped)) genericMatches += 1
    }

    if (androidMatches >= sample.length * 0.6) return 'android_logcat'
    if (genericMatches >= sample.length * 0.6) return 'generic_timestamped'
    return 'unknown'
  }

  /** Parse all entries from `content`. */
  parseLog(content: string, sourceFile: string | null = null): ParseResult {
    const format = this.detectLogFormat(content)
    const logs = [...this.parseWithFormat(content, sourceFile, format)]
    return { logs, total_lines: logs.length, format_detected: format }
  }

  /** Parse one or more log files from `data` (plain text, zip or gzip). */
  parseLogBytes(data: Buffer, filename: string): ParseResult[] {
    return extractTextFiles(data, filename).map((file) =>
      this.parseLog(file.data.toString('utf8'), file.name),
    )
  }

  /** Yield entries from `data` across all extracted members, in order. */
  *streamLogBytes(data: Buffer, filename: string): Generator<LogEntry> {
    for (const file of extractTextFiles(data, filename)) {
      yield* this.parseLogIter(file.data.toString('utf8'), file.name)
    }
  }

  /** Lazily yield entries from `content` after detecting its format. */
  parseLogIter(content: string, sourceFile: string | null = null): Generator<LogEntry> {
    return this.parseWithFormat(content, sourceFile, this.detectLogFormat(content))
  }

  /**
   * Scan a local log file and return metadata without parsing entries.
   *
   * `maxScanLines` stops the line count early; format detection still uses the
   * first 10 non-empty lines encountered.
   */
  scanFileMeta(filePath: string, maxScanLines: number | null = null): FileRef {
    const validated = validatePath(filePath)
    const sizeBytes = fs.statSync(validated).size

    const lower = filePath.toLowerCase()
    const isGzip = lower.endsWith('.gz') && !lower.endsWith('.tar.gz')
    const isZip = lower.endsWith('.zip')

    let lineCount = 0
    const sampleLines: string[] = []
    let truncated = false

    const consume = (rawLine: string): boolean => {
      lineCount += 1
      const stripped = rawLine.trim()
      if (stripped && sampleLines.length < 10) sampleLines.push(stripped)
      // Early exit: stop counting after max_scan_lines.
      if (maxScanLines !== null && lineCount >= maxScanLines) {
        truncated = true
        return false
      }
      return true
    }

    if (isZip) {
      // For ZIP archives, iterate all text members to count lines and collect samples.
      members: for (const member of this.zipTextMembers(validated)) {
        for (const rawLine of splitTextLines(member.data.toString('utf8'))) {
          if (!consume(rawLine)) break members
        }
      }
    } else {
      for (const rawLine of this.textLinesOf(validated)) {
        if (!consume(rawLine)) break
      }
    }

    const sample = sampleLines.join('\n')
    const formatDetected: LogFormat = sample ? this.detectLogFormat(sample) : 'unknown'

    return {
      path: validated,
      line_count: lineCount,
      size_bytes: sizeBytes,
      format_detected: formatDetected,
      is_gzip: isGzip,
      is_zip: isZip,
      truncated,
    }
  }

  /**
   * Stream entries from a local file, one at a time.
   *
   * Never loads the whole file into memory for plain text; handles ``.gz``,
   * ``.zip`` and plain text.
   */
  *streamFile(filePath: string, sandboxRoot: string | null = null): Generator<LogEntry> {
    const validated = validatePath(filePath, sandboxRoot)
    const format = this.detectFormatFromFile(validated)

    const lowerPath = validated.toLowerCase()
    if (lowerPath.endsWith('.zip') && !lowerPath.endsWith('.tar.gz')) {
      let lineNumber = 0
      for (const member of this.zipTextMembers(validated)) {
        for (const rawLine of splitTextLines(member.data.toString('utf8'))) {
          lineNumber += 1
          const line = stripLineEnding(rawLine)
          if (!line.trim()) continue
          yield this.parseSingleLine(line, lineNumber, format, member.name)
        }
      }
      return
    }

    const source = path.basename(validated)
    let lineNumber = 0
    for (const rawLine of this.textLinesOf(validated)) {
      lineNumber += 1
      const line = stripLineEnding(rawLine)
      if (!line.trim()) continue
      yield this.parseSingleLine(line, lineNumber, format, source)
    }
  }

  /** Filter entries with the same semantics as ``createLogFilter``. */
  filterLogs(logs: LogEntry[], filters: LogFilters): LogEntry[] {
    return logs.filter(createLogFilter(filters))
  }

  /** Aggregate level / tag / pid counts over `logs`. */
  getStatistics(logs: LogEntry[]): LogStatistics {
    const byLevel = new Map<string, number>()
    const tags = new Map<string, number>()
    const pids = new Map<string, number>()

    for (const log of logs) {
      byLevel.set(log.level, (byLevel.get(log.level) ?? 0) + 1)
      tags.set(log.tag, (tags.get(log.tag) ?? 0) + 1)
      if (log.pid) pids.set(log.pid, (pids.get(log.pid) ?? 0) + 1)
    }

    // Object.fromEntries creates own properties, so tag/pid values like
    // "__proto__" survive intact.
    return {
      total: logs.length,
      by_level: Object.fromEntries(byLevel),
      tags: Object.fromEntries(tags),
      pids: Object.fromEntries(pids),
    }
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private *parseWithFormat(
    content: string,
    sourceFile: string | null,
    format: LogFormat,
  ): Generator<LogEntry> {
    const lines = content.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const raw = lines[index]
      const line = raw.trim()
      if (!line) continue
      const lineNumber = index + 1

      let entry: LogEntry | null = null
      if (format === 'android_logcat') {
        const match = ANDROID_PATTERN.exec(line)
        if (match) {
          entry = {
            line_number: lineNumber,
            timestamp: match[1].trim(),
            pid: match[2].trim(),
            tid: match[3].trim(),
            level: match[4].trim(),
            tag: match[5].trim(),
            message: match[6].trim(),
            raw_line: line,
            source_file: sourceFile,
          }
        }
      } else if (format === 'generic_timestamped') {
        const match = GENERIC_PATTERN.exec(line)
        if (match) {
          entry = {
            line_number: lineNumber,
            timestamp: match[1].trim(),
            pid: null,
            tid: null,
            level: this.normalizeLevel(match[2]),
            tag: 'Generic',
            message: match[3].trim(),
            raw_line: line,
            source_file: sourceFile,
          }
        }
      }

      yield entry ?? {
        line_number: lineNumber,
        timestamp: null,
        pid: null,
        tid: null,
        level: 'U',
        tag: 'Unknown',
        message: line,
        raw_line: line,
        source_file: sourceFile,
      }
    }
  }

  private parseSingleLine(
    line: string,
    lineNumber: number,
    format: LogFormat,
    sourceFile: string | null,
  ): LogEntry {
    if (format === 'android_logcat') {
      const match = ANDROID_PATTERN.exec(line.trim())
      if (match) {
        return {
          line_number: lineNumber,
          timestamp: match[1].trim(),
          pid: match[2].trim(),
          tid: match[3].trim(),
          level: match[4].trim(),
          tag: match[5].trim(),
          message: match[6].trim(),
          raw_line: line,
          source_file: sourceFile,
        }
      }
    } else if (format === 'generic_timestamped') {
      const match = GENERIC_PATTERN.exec(line.trim())
      if (match) {
        return {
          line_number: lineNumber,
          timestamp: match[1].trim(),
          pid: null,
          tid: null,
          level: this.normalizeLevel(match[2]),
          tag: 'Generic',
          message: match[3].trim(),
          raw_line: line,
          source_file: sourceFile,
        }
      }
    }

    // Fallback: unknown format or no match.
    return {
      line_number: lineNumber,
      timestamp: null,
      pid: null,
      tid: null,
      level: 'U',
      tag: 'Unknown',
      message: line.trim(),
      raw_line: line,
      source_file: sourceFile,
    }
  }

  private normalizeLevel(level: string): string {
    const upper = level.toUpperCase()
    if (upper === 'VERBOSE' || upper === 'V') return 'V'
    if (upper === 'DEBUG' || upper === 'D') return 'D'
    if (upper === 'INFO' || upper === 'I') return 'I'
    if (upper === 'W' || upper === 'WARN' || upper === 'WARNING') return 'W'
    if (upper === 'ERROR' || upper === 'E') return 'E'
    if (upper === 'FATAL' || upper === 'F') return 'F'
    return 'U'
  }

  /** Read the first 10 non-empty lines and detect the format from them. */
  private detectFormatFromFile(filePath: string): LogFormat {
    const sampleLines: string[] = []
    for (const rawLine of this.textLinesOf(filePath)) {
      const stripped = rawLine.trim()
      if (stripped && sampleLines.length < 10) sampleLines.push(stripped)
      if (sampleLines.length >= 10) break
    }
    if (sampleLines.length === 0) return 'unknown'
    return this.detectLogFormat(sampleLines.join('\n'))
  }

  /**
   * Yield the textual lines of a local log file.
   *
   * Mirrors Python's ``_open_log_path``: gzip is inflated, zip yields the first
   * text member only, anything else is read as UTF-8.
   */
  private *textLinesOf(filePath: string): Generator<string> {
    const lower = filePath.toLowerCase()

    if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz')) {
      yield* splitTextLines(gunzipSync(fs.readFileSync(filePath)).toString('utf8'))
      return
    }

    if (lower.endsWith('.zip')) {
      for (const member of this.zipTextMembers(filePath)) {
        yield* splitTextLines(member.data.toString('utf8'))
        return
      }
      return
    }

    yield* readFileLines(filePath)
  }

  /** Yield every log-shaped member of a ZIP archive, in central-directory order. */
  private *zipTextMembers(archivePath: string): Generator<{ name: string; data: Buffer }> {
    const archive = fs.readFileSync(archivePath)
    let entries
    try {
      entries = readZipEntries(archive)
    } catch (error) {
      throw new Error(`Invalid ZIP file: ${(error as Error).message}`)
    }

    for (const entry of entries) {
      if (entry.isDirectory) continue
      if (!isLogName(entry.name)) continue
      let data: Buffer
      try {
        data = readZipMember(archive, entry)
      } catch (error) {
        throw new Error(`Invalid ZIP file: ${(error as Error).message}`)
      }
      yield { name: entry.name, data }
    }
  }
}
