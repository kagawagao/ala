/**
 * Archive / multi-file extraction helpers.
 *
 * Port of the module-level helpers in ``backend/src/ala/services/log_analyzer.py``:
 * plain text passes through untouched, ``.zip`` archives are walked member by
 * member (recursing into nested archives), ``.gz`` is inflated, and ``.rar`` /
 * ``.7z`` are handed to a system extractor (7z / 7za / unrar) when one is
 * available.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { ZipMemberTooLargeError, readZipEntries, readZipMember } from './zip.ts'

/** File extensions treated as log text files (extensionless = ANR / tombstone). */
const LOG_TEXT_EXTS = new Set(['.log', '.txt', '.logcat', '.trace', '.anr', ''])

/** Maximum size (bytes) for a single decoded text file to prevent OOM. */
export const MAX_DECODE_BYTES = 256 * 1024 * 1024

/** Maximum recursion depth for nested archive decompression (zip-bomb guard). */
const MAX_DECOMPRESS_DEPTH = 5

export interface ExtractedTextFile {
  name: string
  data: Buffer
}

/** "268,435,456" — matches Python's ``f"{n:,}"`` formatting. */
function formatBytes(size: number): string {
  return size.toLocaleString('en-US')
}

/** Return true when `name` looks like a plain-text log file. */
export function isLogName(name: string): boolean {
  const lower = name.toLowerCase()
  return LOG_TEXT_EXTS.has(path.extname(lower))
}

/** Return true when `name` looks like a compressed/archive file. */
export function isCompressedName(name: string): boolean {
  const lower = name.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return true
  return ['.gz', '.zip', '.rar', '.7z'].includes(path.extname(lower))
}

function isBufferTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE'
  )
}

/** Inflate a gzip buffer, enforcing the same decoded-size budget as Python. */
function gunzipWithLimit(data: Buffer): Buffer {
  let inflated: Buffer
  try {
    inflated = gunzipSync(data, { maxOutputLength: MAX_DECODE_BYTES + 1 })
  } catch (error) {
    if (isBufferTooLarge(error)) {
      throw new Error(`Decompressed size exceeds ${formatBytes(MAX_DECODE_BYTES)} byte limit`)
    }
    throw new Error(`Invalid gzip file: ${(error as Error).message}`)
  }
  if (inflated.length > MAX_DECODE_BYTES) {
    throw new Error(`Decompressed size exceeds ${formatBytes(MAX_DECODE_BYTES)} byte limit`)
  }
  return inflated
}

/**
 * Extract text file contents from `data`.
 *
 * Returns a list of ``{ name, data }`` pairs. Nested archives (a ``.zip``
 * containing ``.gz`` members, a ``.gz`` whose payload is itself a ``.zip``) are
 * decompressed recursively until plain-text files are reached.
 *
 * Supports ``.zip``, ``.gz``, ``.rar`` / ``.7z`` (via a system extractor) and
 * plain text.
 */
export function extractTextFiles(data: Buffer, filename: string): ExtractedTextFile[] {
  return extractTextFilesAtDepth(data, filename, 0)
}

function extractTextFilesAtDepth(
  data: Buffer,
  filename: string,
  depth: number,
): ExtractedTextFile[] {
  if (depth > MAX_DECOMPRESS_DEPTH) {
    return [{ name: filename, data: data.subarray(0, MAX_DECODE_BYTES) }]
  }

  const lower = filename.toLowerCase()

  if (lower.endsWith('.zip')) {
    const members = extractZipMembers(data, depth)
    return members.length > 0 ? members : [{ name: '(empty zip)', data: Buffer.alloc(0) }]
  }

  if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz')) {
    const decompressed = gunzipWithLimit(data)
    const innerName = filename.length > 3 ? filename.slice(0, -3) : filename
    if (isCompressedName(innerName)) {
      return extractTextFilesAtDepth(decompressed, innerName, depth + 1)
    }
    return [{ name: innerName, data: decompressed.subarray(0, MAX_DECODE_BYTES) }]
  }

  if (lower.endsWith('.rar') || lower.endsWith('.7z')) {
    return extractWithSystemTool(data, filename)
  }

  // Plain text – return as-is.
  return [{ name: filename, data: data.subarray(0, MAX_DECODE_BYTES) }]
}

function extractZipMembers(data: Buffer, depth: number): ExtractedTextFile[] {
  let entries
  try {
    entries = readZipEntries(data)
  } catch (error) {
    throw new Error(`Invalid ZIP file: ${(error as Error).message}`)
  }

  const results: ExtractedTextFile[] = []
  for (const entry of entries) {
    // Directories only — no other member is skipped up front.
    if (entry.isDirectory) continue
    const memberName = entry.name

    let memberData: Buffer
    try {
      memberData = readZipMember(data, entry, MAX_DECODE_BYTES)
    } catch (error) {
      if (error instanceof ZipMemberTooLargeError) continue
      throw new Error(`Invalid ZIP file: ${(error as Error).message}`)
    }

    if (isCompressedName(memberName)) {
      results.push(...extractTextFilesAtDepth(memberData, memberName, depth + 1))
    } else if (isLogName(memberName)) {
      results.push({ name: memberName, data: memberData })
    }
    // Other members (images, binaries, ...) are ignored.
  }
  return results
}

// ---------------------------------------------------------------------------
// System-extractor fallback (.rar / .7z)
// ---------------------------------------------------------------------------

function isExecutableFile(candidate: string): boolean {
  try {
    if (!fs.statSync(candidate).isFile()) return false
    fs.accessSync(candidate, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Locate 7z / 7za / unrar on PATH (plus the usual Windows install dirs). */
function locateSystemExtractor(): string | null {
  const searchDirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const name of ['7z', '7za', 'unrar']) {
    for (const directory of searchDirs) {
      const candidate = path.join(directory, process.platform === 'win32' ? `${name}.exe` : name)
      if (isExecutableFile(candidate)) return candidate
    }
  }
  if (process.platform === 'win32') {
    for (const candidate of [
      'C:\\Program Files\\7-Zip\\7z.exe',
      'C:\\Program Files (x86)\\7-Zip\\7z.exe',
    ]) {
      if (isExecutableFile(candidate)) return candidate
    }
  }
  return null
}

/** Recursively collect log-shaped files, named relative to `root`. */
function collectLogFiles(root: string): ExtractedTextFile[] {
  const results: ExtractedTextFile[] = []

  const walk = (directory: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch {
      return
    }
    // Sorted so extraction output is deterministic across platforms.
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile() || !isLogName(entry.name)) continue
      let size: number
      try {
        size = fs.statSync(full).size
      } catch {
        continue
      }
      if (size > MAX_DECODE_BYTES) continue
      const buffer = fs.readFileSync(full)
      if (buffer.length > MAX_DECODE_BYTES) continue
      results.push({ name: path.relative(root, full), data: buffer })
    }
  }

  walk(root)
  if (results.length === 0) results.push({ name: '(empty archive)', data: Buffer.alloc(0) })
  return results
}

/**
 * Extract a ``.rar`` / ``.7z`` payload with a system tool in a temp directory.
 *
 * The archive is written to a fresh temp dir, extracted into a sibling
 * directory, and its log-shaped files are collected with paths relative to the
 * extraction root (matching ``_collect_log_files``). Everything is removed
 * afterwards.
 */
function extractWithSystemTool(data: Buffer, filename: string): ExtractedTextFile[] {
  const extension = path.extname(filename.toLowerCase()) || 'archive'
  const extractor = locateSystemExtractor()
  if (!extractor) {
    throw new Error(
      `Cannot extract ${extension} archive: no system extractor found. ` +
        'Install 7-Zip (https://7-zip.org) or unrar and ensure it is on PATH.',
    )
  }

  const is7zTool = /7z/i.test(path.basename(extractor))
  if (extension === '.7z' && !is7zTool) {
    throw new Error('Cannot extract .7z archive with unrar: install 7-Zip (https://7-zip.org).')
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ala_archive_'))
  try {
    const archivePath = path.join(tempRoot, path.basename(filename) || `archive${extension}`)
    fs.writeFileSync(archivePath, data)

    const outputDir = path.join(tempRoot, 'extracted')
    fs.mkdirSync(outputDir, { recursive: true })

    const args = is7zTool
      ? ['x', '-y', `-o${outputDir}`, archivePath]
      : ['x', '-y', archivePath, `${outputDir}${path.sep}`]

    try {
      execFileSync(extractor, args, {
        timeout: 300_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      })
    } catch (error) {
      const execError = error as { stderr?: Buffer; message?: string }
      const stderr = execError.stderr ? execError.stderr.toString('utf8') : ''
      const detail = (stderr || execError.message || '').slice(0, 500)
      const lowered = detail.toLowerCase()
      const splitArchive =
        lowered.includes('cannot find volume') ||
        lowered.includes('missing volume') ||
        lowered.includes('need the following volume') ||
        lowered.includes('next volume') ||
        lowered.includes('can not open file')
      if (splitArchive) {
        throw new Error(
          'Split archive extraction failed — missing parts. Ensure all parts of this ' +
            `split archive are downloaded to the same directory before extraction. Error: ${detail.slice(0, 300)}`,
        )
      }
      throw new Error(`Archive extraction failed: ${detail}`)
    }

    return collectLogFiles(outputDir)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}
