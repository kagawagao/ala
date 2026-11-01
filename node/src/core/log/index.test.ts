import fs from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync, gzipSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LogAnalyzer,
  LogPathError,
  createLogFilter,
  extractTextFiles,
  type LogEntry,
  type LogFilters,
} from './index.ts'

const SAMPLE_LOGCAT = `01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main
01-15 10:30:45.124  1234  5678 E AndroidRuntime: Process: com.example.app, PID: 1234
01-15 10:30:45.125  1234  5678 D ActivityManager: Activity resumed
01-15 10:30:45.126  2345  6789 I SystemServer: Started service
01-15 10:30:45.127  2345  6789 W MemoryInfo: Low memory warning
`

/**
 * Build a ZIP archive in memory (stored or deflated members) so archive
 * fixtures stay inline and the port stays dependency-free.
 */
function makeZip(files: Array<{ name: string; data: Buffer | string; deflate?: boolean }>): Buffer {
  const parts: Buffer[] = []
  const centralEntries: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const raw = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : file.data
    const method = file.deflate === false ? 0 : 8
    const payload = method === 8 ? deflateRawSync(raw) : raw
    const checksum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)

    parts.push(local, name, payload)
    centralEntries.push(Buffer.concat([central, name]))
    offset += local.length + name.length + payload.length
  }

  const directory = Buffer.concat(centralEntries)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...parts, directory, end])
}

const analyzer = new LogAnalyzer()

const collect = (iterator: Generator<LogEntry>): LogEntry[] => [...iterator]

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ala-log-test-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

async function writeTemp(name: string, content: string | Buffer): Promise<string> {
  const target = join(directory, name)
  await writeFile(target, content)
  return target
}

describe('detectLogFormat', () => {
  it('detects android logcat lines', () => {
    expect(analyzer.detectLogFormat(SAMPLE_LOGCAT)).toBe('android_logcat')
  })

  it('detects generic timestamped lines', () => {
    const content =
      '[2024-01-15 10:30:45] ERROR: Something went wrong\n2024-01-15 10:30:46 INFO Server started\n'
    expect(analyzer.detectLogFormat(content)).toBe('generic_timestamped')
  })

  it('returns unknown for free-form text', () => {
    expect(analyzer.detectLogFormat('just some random text\nand more of it\n')).toBe('unknown')
  })

  it('returns unknown for empty content', () => {
    expect(analyzer.detectLogFormat('')).toBe('unknown')
    expect(analyzer.detectLogFormat('\n   \n\t\n')).toBe('unknown')
  })

  it('uses a 60% match threshold over at most 10 non-empty lines', () => {
    const androidLine = '01-15 10:30:45.123  1234  5678 E Tag: msg'
    const sixOfTen = [
      ...Array.from({ length: 6 }, () => androidLine),
      ...Array.from({ length: 4 }, () => 'plain text'),
    ]
    expect(analyzer.detectLogFormat(sixOfTen.join('\n'))).toBe('android_logcat')

    const fiveOfTen = [
      ...Array.from({ length: 5 }, () => androidLine),
      ...Array.from({ length: 5 }, () => 'plain text'),
    ]
    expect(analyzer.detectLogFormat(fiveOfTen.join('\n'))).toBe('unknown')
  })

  it('ignores lines beyond the first 10', () => {
    const lines = [
      ...Array.from({ length: 10 }, () => 'plain text'),
      ...Array.from({ length: 10 }, () => '01-15 10:30:45.123  1234  5678 E Tag: msg'),
    ]
    expect(analyzer.detectLogFormat(lines.join('\n'))).toBe('unknown')
  })
})

describe('parseLog android logcat', () => {
  it('parses entries with pid, tid, level and tag', () => {
    const result = analyzer.parseLog(SAMPLE_LOGCAT)
    expect(result.total_lines).toBe(5)
    expect(result.logs).toHaveLength(5)
    expect(result.format_detected).toBe('android_logcat')
    expect(result.logs[0]).toMatchObject({
      line_number: 1,
      timestamp: '01-15 10:30:45.123',
      pid: '1234',
      tid: '5678',
      level: 'E',
      tag: 'AndroidRuntime',
      message: 'FATAL EXCEPTION: main',
      raw_line: '01-15 10:30:45.123  1234  5678 E AndroidRuntime: FATAL EXCEPTION: main',
      source_file: null,
    })
    expect(result.logs[4].level).toBe('W')
    expect(result.logs[4].tag).toBe('MemoryInfo')
  })

  it('keeps a raw_line identical to the trimmed input line', () => {
    const result = analyzer.parseLog('  01-15 10:30:45.123  1234  5678 D Tag:  spaced  \n')
    expect(result.logs[0].raw_line).toBe('01-15 10:30:45.123  1234  5678 D Tag:  spaced')
    expect(result.logs[0].message).toBe('spaced')
  })

  it('falls back to level U / tag Unknown for unmatched lines', () => {
    const result = analyzer.parseLog(
      `01-15 10:30:45.123  1234  5678 E Tag: ok\nnot a logcat line\n`,
    )
    expect(result.format_detected).toBe('unknown')
    expect(result.logs[1]).toMatchObject({
      line_number: 2,
      level: 'U',
      tag: 'Unknown',
      message: 'not a logcat line',
      timestamp: null,
      pid: null,
      tid: null,
    })
  })

  it('propagates source_file to every entry', () => {
    const result = analyzer.parseLog(SAMPLE_LOGCAT, 'device.log')
    expect(result.logs.every((entry) => entry.source_file === 'device.log')).toBe(true)
  })

  it('preserves line numbers across blank lines', () => {
    const content = `\n01-15 10:30:45.123  1234  5678 E Tag: one\n\n01-15 10:30:45.124  1234  5678 I Tag: two\n`
    const result = analyzer.parseLog(content)
    expect(result.logs.map((entry) => entry.line_number)).toEqual([2, 4])
  })

  it('parses CR-only content as one line, matching Python', () => {
    const content =
      '01-15 10:30:45.123  1234  5678 E Tag: one\r01-15 10:30:45.124  1234  5678 I Tag: two\r'
    const result = analyzer.parseLog(content)
    expect(result.format_detected).toBe('android_logcat')
    expect(result.logs).toHaveLength(1)
    expect(result.logs[0].message).toBe('one\r01-15 10:30:45.124  1234  5678 I Tag: two')
  })

  it('returns an empty result for empty input', () => {
    const result = analyzer.parseLog('')
    expect(result.total_lines).toBe(0)
    expect(result.logs).toEqual([])
    expect(result.format_detected).toBe('unknown')
  })
})

describe('parseLog generic timestamped', () => {
  it('parses bracketed timestamps and normalizes levels', () => {
    const content =
      '[2024-01-15 10:30:45] ERROR: Something went wrong\n2024-01-15 10:30:46 INFO Server started\n'
    const result = analyzer.parseLog(content)
    expect(result.format_detected).toBe('generic_timestamped')
    expect(result.logs[0]).toMatchObject({
      timestamp: '2024-01-15 10:30:45',
      level: 'E',
      tag: 'Generic',
      message: 'Something went wrong',
      pid: null,
      tid: null,
    })
    expect(result.logs[1].level).toBe('I')
    expect(result.logs[1].message).toBe('Server started')
  })

  it.each([
    ['VERBOSE', 'V'],
    ['DEBUG', 'D'],
    ['INFO', 'I'],
    ['WARN', 'W'],
    ['WARNING', 'W'],
    ['ERROR', 'E'],
    ['FATAL', 'F'],
    ['NOTICE', 'U'],
  ])('normalizes level %s to %s', (word, expected) => {
    const entry = analyzer.parseLog(`[2024-01-15 10:30:45] ${word}: payload\n`).logs[0]
    expect(entry.level).toBe(expected)
  })

  it('normalizes single-letter levels and is case-insensitive', () => {
    expect(analyzer.parseLog('[2024-01-15 10:30:45] V: x\n').logs[0].level).toBe('V')
    expect(analyzer.parseLog('[2024-01-15 10:30:45] W: x\n').logs[0].level).toBe('W')
    expect(analyzer.parseLog('[2024-01-15 10:30:45] error: x\n').logs[0].level).toBe('E')
    expect(analyzer.parseLog('[2024-01-15 10:30:45] F: x\n').logs[0].level).toBe('F')
  })

  it('supports slashes in timestamps and an optional milliseconds field', () => {
    const entry = analyzer.parseLog('2024/01/15 10:30:45.123 DEBUG - hello\n').logs[0]
    expect(entry.timestamp).toBe('2024/01/15 10:30:45.123')
    expect(entry.level).toBe('D')
    expect(entry.message).toBe('hello')
  })

  it('does not require brackets around the level', () => {
    const entry = analyzer.parseLog('2024-01-15 10:30:45 [INFO]: bracketed\n').logs[0]
    expect(entry.level).toBe('I')
    expect(entry.message).toBe('bracketed')
  })
})

describe('parseLog unknown format', () => {
  it('wraps every non-empty line into a fallback entry', () => {
    const result = analyzer.parseLog('just some random text\n\nsecond line\n')
    expect(result.format_detected).toBe('unknown')
    expect(result.logs).toHaveLength(2)
    expect(result.logs[0]).toMatchObject({
      line_number: 1,
      level: 'U',
      tag: 'Unknown',
      message: 'just some random text',
      raw_line: 'just some random text',
      timestamp: null,
    })
    expect(result.logs[1].line_number).toBe(3)
  })
})

describe('streaming parse', () => {
  it('parseLogIter matches parseLog', () => {
    const expected = analyzer.parseLog(SAMPLE_LOGCAT, 'device.log')
    expect(collect(analyzer.parseLogIter(SAMPLE_LOGCAT, 'device.log'))).toEqual(expected.logs)
  })

  it('parseLogBytes parses plain text', () => {
    const results = analyzer.parseLogBytes(Buffer.from(SAMPLE_LOGCAT), 'device.log')
    expect(results).toHaveLength(1)
    expect(results[0].total_lines).toBe(5)
    expect(results[0].format_detected).toBe('android_logcat')
  })

  it('parseLogBytes parses gzip with the inner filename as source_file', () => {
    const results = analyzer.parseLogBytes(gzipSync(Buffer.from(SAMPLE_LOGCAT)), 'device.log.gz')
    expect(results).toHaveLength(1)
    expect(results[0].total_lines).toBe(5)
    expect(results[0].logs.every((entry) => entry.source_file === 'device.log')).toBe(true)
  })

  it('parseLogBytes parses each zip member', () => {
    const archive = makeZip([
      { name: 'a.log', data: SAMPLE_LOGCAT },
      { name: 'b.log', data: SAMPLE_LOGCAT },
    ])
    const results = analyzer.parseLogBytes(archive, 'logs.zip')
    expect(results).toHaveLength(2)
    expect(results.map((result) => result.total_lines)).toEqual([5, 5])
    expect(results.map((result) => result.logs[0].source_file)).toEqual(['a.log', 'b.log'])
  })

  it('streamLogBytes yields gzip entries', () => {
    const entries = collect(
      analyzer.streamLogBytes(gzipSync(Buffer.from(SAMPLE_LOGCAT)), 'device.log.gz'),
    )
    expect(entries).toHaveLength(5)
    expect(entries[0].level).toBe('E')
    expect(entries.every((entry) => entry.source_file === 'device.log')).toBe(true)
  })

  it('streamLogBytes yields every entry of every zip member', () => {
    const archive = makeZip([
      { name: 'a.log', data: SAMPLE_LOGCAT },
      { name: 'b.log', data: SAMPLE_LOGCAT },
    ])
    const entries = collect(analyzer.streamLogBytes(archive, 'logs.zip'))
    expect(entries).toHaveLength(10)
    expect(new Set(entries.map((entry) => entry.source_file))).toEqual(new Set(['a.log', 'b.log']))
  })
})

describe('extractTextFiles', () => {
  it('returns plain text unchanged', () => {
    const data = Buffer.from('hello log line\n')
    const result = extractTextFiles(data, 'device.log')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('device.log')
    expect(result[0].data.equals(data)).toBe(true)
  })

  it('inflates gzip and strips the .gz suffix from the name', () => {
    const original = Buffer.from(SAMPLE_LOGCAT)
    const result = extractTextFiles(gzipSync(original), 'device.log.gz')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('device.log')
    expect(result[0].data.equals(original)).toBe(true)
  })

  it('extracts a deflated zip member', () => {
    const archive = makeZip([{ name: 'system.log', data: SAMPLE_LOGCAT }])
    const result = extractTextFiles(archive, 'logs.zip')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('system.log')
    expect(result[0].data.toString('utf8')).toBe(SAMPLE_LOGCAT)
  })

  it('extracts a stored (uncompressed) zip member', () => {
    const archive = makeZip([{ name: 'system.log', data: SAMPLE_LOGCAT, deflate: false }])
    const result = extractTextFiles(archive, 'logs.zip')
    expect(result).toHaveLength(1)
    expect(result[0].data.toString('utf8')).toBe(SAMPLE_LOGCAT)
  })

  it('extracts multiple log members and skips directories and non-log members', () => {
    const archive = makeZip([
      { name: 'folder/', data: Buffer.alloc(0) },
      { name: 'system.log', data: SAMPLE_LOGCAT },
      { name: 'radio.log', data: SAMPLE_LOGCAT },
      { name: 'image.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ])
    const result = extractTextFiles(archive, 'bugreport.zip')
    expect(result.map((file) => file.name).sort()).toEqual(['radio.log', 'system.log'])
  })

  it('recurses into a nested archive inside a zip', () => {
    const nested = makeZip([{ name: 'inner.log', data: SAMPLE_LOGCAT }])
    const archive = makeZip([{ name: 'nested.zip', data: nested }])
    const result = extractTextFiles(archive, 'outer.zip')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('inner.log')
  })

  it('recurses into a zip wrapped in gzip', () => {
    const nested = makeZip([{ name: 'system.log', data: SAMPLE_LOGCAT }])
    const result = extractTextFiles(gzipSync(nested), 'inner.zip.gz')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('system.log')
  })

  it('returns a placeholder when a zip has no log members', () => {
    const archive = makeZip([{ name: 'image.png', data: Buffer.from('png') }])
    const result = extractTextFiles(archive, 'empty.zip')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('(empty zip)')
    expect(result[0].data.length).toBe(0)
  })

  it('raises for invalid gzip input', () => {
    expect(() => extractTextFiles(Buffer.from('notgzip'), 'bad.gz')).toThrow(/Invalid gzip/)
  })

  it('raises for invalid zip input', () => {
    expect(() => extractTextFiles(Buffer.from('notzip'), 'bad.zip')).toThrow(/Invalid ZIP/)
  })

  it('raises for invalid zip input with a truncated central directory', () => {
    const archive = makeZip([{ name: 'system.log', data: SAMPLE_LOGCAT }])
    const truncated = archive.subarray(0, archive.length - 10)
    expect(() => extractTextFiles(truncated, 'bad.zip')).toThrow(/Invalid ZIP/)
  })
})

describe('filterLogs', () => {
  const logs = analyzer.parseLog(SAMPLE_LOGCAT).logs

  it('filters by level', () => {
    const filtered = analyzer.filterLogs(logs, { level: 'E' })
    expect(filtered).toHaveLength(2)
    expect(filtered.every((entry) => entry.level === 'E')).toBe(true)
  })

  it('treats level ALL as no level filter', () => {
    expect(analyzer.filterLogs(logs, { level: 'ALL' })).toHaveLength(5)
  })

  it('filters by tag regex (case-insensitive)', () => {
    expect(analyzer.filterLogs(logs, { tag: 'AndroidRuntime' })).toHaveLength(2)
    expect(analyzer.filterLogs(logs, { tag: 'androidruntime' })).toHaveLength(2)
    expect(analyzer.filterLogs(logs, { tag: 'Activity.*' })).toHaveLength(1)
  })

  it('filters by keyword', () => {
    const filtered = analyzer.filterLogs(logs, { keywords: 'FATAL' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].message).toBe('FATAL EXCEPTION: main')
  })

  it('matches keywords in raw_line as well as message', () => {
    const filtered = analyzer.filterLogs(logs, { keywords: '1234' })
    expect(filtered.length).toBeGreaterThanOrEqual(3)
  })

  it('returns nothing when nothing matches', () => {
    expect(analyzer.filterLogs(logs, { keywords: 'XXXXXXXXXNOTFOUND' })).toHaveLength(0)
  })

  it('combines tag and keyword with AND by default', () => {
    expect(analyzer.filterLogs(logs, { tag: 'ActivityManager', keywords: 'FATAL' })).toHaveLength(0)
  })

  it('combines tag and keyword with OR when requested', () => {
    const filtered = analyzer.filterLogs(logs, {
      tag: 'ActivityManager',
      keywords: 'FATAL',
      tag_keyword_relation: 'OR',
    })
    expect(filtered).toHaveLength(2)
  })

  it('filters by time range (lexicographic on timestamps)', () => {
    const filtered = analyzer.filterLogs(logs, { start_time: '01-15 10:30:45.125' })
    expect(filtered.map((entry) => entry.timestamp)).toEqual([
      '01-15 10:30:45.125',
      '01-15 10:30:45.126',
      '01-15 10:30:45.127',
    ])
    expect(analyzer.filterLogs(logs, { end_time: '01-15 10:30:45.124' })).toHaveLength(2)
    expect(
      analyzer.filterLogs(logs, {
        start_time: '01-15 10:30:45.124',
        end_time: '01-15 10:30:45.126',
      }),
    ).toHaveLength(3)
  })

  it('filters by pid and tid', () => {
    const byPid = analyzer.filterLogs(logs, { pid: '1234' })
    expect(byPid).toHaveLength(3)
    expect(byPid.every((entry) => entry.pid === '1234')).toBe(true)

    const byTid = analyzer.filterLogs(logs, { tid: '6789' })
    expect(byTid).toHaveLength(2)
    expect(byTid.every((entry) => entry.tid === '6789')).toBe(true)
  })

  it('falls back to substring matching for invalid regex patterns', () => {
    const entries: LogEntry[] = [
      {
        line_number: 1,
        timestamp: null,
        pid: null,
        tid: null,
        level: 'E',
        tag: 'Native',
        message: 'C++ crash',
        raw_line: 'C++ crash',
        source_file: null,
      },
    ]
    expect(analyzer.filterLogs(entries, { keywords: 'C++' })).toHaveLength(1)
    expect(analyzer.filterLogs(entries, { keywords: 'c++' })).toHaveLength(1)
    expect(analyzer.filterLogs(entries, { keywords: 'rust' })).toHaveLength(0)
  })
})

describe('createLogFilter', () => {
  const logs = analyzer.parseLog(SAMPLE_LOGCAT).logs

  const filterSets: LogFilters[] = [
    { level: 'E' },
    { tag: 'ActivityManager' },
    { keywords: 'FATAL' },
    { tag: 'ActivityManager', keywords: 'FATAL', tag_keyword_relation: 'OR' },
    { tag: 'AndroidRuntime', keywords: 'Process', tag_keyword_relation: 'AND' },
    { start_time: '01-15 10:30:45.125', level: 'I' },
    { pid: '1234', tid: '5678' },
    {},
  ]

  it.each(filterSets)('matches filterLogs for %j', (filters) => {
    const predicate = createLogFilter(filters)
    expect(logs.filter(predicate)).toEqual(analyzer.filterLogs(logs, filters))
  })

  it('is stateless across repeated calls', () => {
    const predicate = createLogFilter({ keywords: 'E' })
    expect(predicate(logs[0])).toBe(true)
    expect(predicate(logs[0])).toBe(true)
  })

  it('skips timestamped checks for entries without timestamps when a range is set', () => {
    const entry: LogEntry = {
      line_number: 1,
      timestamp: null,
      pid: null,
      tid: null,
      level: 'E',
      tag: 'Unknown',
      message: 'no timestamp',
      raw_line: 'no timestamp',
      source_file: null,
    }
    expect(createLogFilter({ start_time: '2024-01-01' })(entry)).toBe(false)
    expect(createLogFilter({})(entry)).toBe(true)
  })
})

describe('getStatistics', () => {
  it('counts totals, levels, tags and pids', () => {
    const stats = analyzer.getStatistics(analyzer.parseLog(SAMPLE_LOGCAT).logs)
    expect(stats.total).toBe(5)
    expect(stats.by_level).toEqual({ E: 2, D: 1, I: 1, W: 1 })
    expect(stats.tags).toEqual({
      AndroidRuntime: 2,
      ActivityManager: 1,
      SystemServer: 1,
      MemoryInfo: 1,
    })
    expect(stats.pids).toEqual({ '1234': 3, '2345': 2 })
  })

  it('handles empty input', () => {
    expect(analyzer.getStatistics([])).toEqual({ total: 0, by_level: {}, tags: {}, pids: {} })
  })

  it('omits null pids', () => {
    const stats = analyzer.getStatistics(analyzer.parseLog('[2024-01-15 10:30:45] INFO: hi\n').logs)
    expect(stats.total).toBe(1)
    expect(stats.pids).toEqual({})
  })
})

describe('path validation', () => {
  it('rejects .. traversal before normalization', () => {
    expect(() => analyzer.scanFileMeta('../outside.log')).toThrow(LogPathError)
    expect(() => analyzer.scanFileMeta('../outside.log')).toThrow(/Path traversal/)
    expect(() => analyzer.scanFileMeta('foo/../bar')).toThrow(/Path traversal/)
  })

  it('rejects missing files', async () => {
    expect(() => analyzer.scanFileMeta(join(directory, 'missing.log'))).toThrow(/File not found/)
    expect(() => analyzer.scanFileMeta(join(directory, 'missing.log'))).toThrow(LogPathError)
  })

  it('rejects directories', () => {
    expect(() => analyzer.scanFileMeta(directory)).toThrow(/Path is a directory/)
    try {
      analyzer.scanFileMeta(directory)
      expect.unreachable()
    } catch (error) {
      expect((error as LogPathError).code).toBe('NOT_A_FILE')
    }
  })

  it('rejects files outside an explicit sandbox root', async () => {
    const sandbox = join(directory, 'sandbox')
    await fs.promises.mkdir(sandbox)
    const outside = await writeTemp('outside.log', SAMPLE_LOGCAT)
    expect(() => analyzer.streamFile(outside, sandbox).next()).toThrow(/outside allowed/)
    try {
      analyzer.streamFile(outside, sandbox).next()
      expect.unreachable()
    } catch (error) {
      expect((error as LogPathError).code).toBe('OUTSIDE_SANDBOX')
    }
  })

  it('rejects siblings whose name merely starts with the sandbox path', async () => {
    const sandbox = join(directory, 'sandbox')
    const evil = join(directory, 'sandbox-evil')
    await fs.promises.mkdir(sandbox)
    await fs.promises.mkdir(evil)
    const target = join(evil, 'inside.log')
    await writeFile(target, SAMPLE_LOGCAT)
    expect(() => analyzer.streamFile(target, sandbox).next()).toThrow(/outside allowed/)
  })

  it('resolves symlinks to the real path', async () => {
    const target = await writeTemp('real.log', SAMPLE_LOGCAT)
    const link = join(directory, 'link.log')
    await fs.promises.symlink(target, link)
    expect(analyzer.scanFileMeta(link).path).toBe(fs.realpathSync(target))
  })

  it('accepts files inside the sandbox root', async () => {
    const sandbox = join(directory, 'sandbox')
    await fs.promises.mkdir(sandbox)
    const inside = join(sandbox, 'test.log')
    await writeFile(inside, SAMPLE_LOGCAT)
    const entries = collect(analyzer.streamFile(inside, sandbox))
    expect(entries).toHaveLength(5)
  })

  it('honours ALA_SANDBOX_ROOT from the environment', async () => {
    const sandbox = join(directory, 'env-sandbox')
    await fs.promises.mkdir(sandbox)
    const inside = join(sandbox, 'test.log')
    await writeFile(inside, SAMPLE_LOGCAT)

    const original = process.env.ALA_SANDBOX_ROOT
    process.env.ALA_SANDBOX_ROOT = sandbox
    try {
      expect(collect(analyzer.streamFile(inside))).toHaveLength(5)
      const outside = await writeTemp('env-outside.log', SAMPLE_LOGCAT)
      expect(() => analyzer.streamFile(outside).next()).toThrow(/outside allowed/)
    } finally {
      if (original === undefined) delete process.env.ALA_SANDBOX_ROOT
      else process.env.ALA_SANDBOX_ROOT = original
    }
  })

  it('rejects unreadable files', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return
    const target = await writeTemp('locked.log', SAMPLE_LOGCAT)
    await chmod(target, 0o000)
    try {
      expect(() => analyzer.scanFileMeta(target)).toThrow(/Permission denied/)
    } finally {
      await chmod(target, 0o644)
    }
  })
})

describe('scanFileMeta', () => {
  it('scans a plain text file', async () => {
    const target = await writeTemp('logcat.log', SAMPLE_LOGCAT)
    const reference = analyzer.scanFileMeta(target)
    expect(reference.path).toBe(fs.realpathSync(target))
    expect(reference.line_count).toBe(5)
    expect(reference.size_bytes).toBe(Buffer.byteLength(SAMPLE_LOGCAT))
    expect(reference.format_detected).toBe('android_logcat')
    expect(reference.is_gzip).toBe(false)
    expect(reference.is_zip).toBe(false)
    expect(reference.truncated).toBe(false)
  })

  it('detects gzip files', async () => {
    const target = await writeTemp('logcat.log.gz', gzipSync(Buffer.from(SAMPLE_LOGCAT)))
    const reference = analyzer.scanFileMeta(target)
    expect(reference.is_gzip).toBe(true)
    expect(reference.line_count).toBe(5)
    expect(reference.format_detected).toBe('android_logcat')
  })

  it('detects zip files and counts text members', async () => {
    const single = await writeTemp(
      'single.zip',
      makeZip([{ name: 'system.log', data: SAMPLE_LOGCAT }]),
    )
    const singleRef = analyzer.scanFileMeta(single)
    expect(singleRef.is_zip).toBe(true)
    expect(singleRef.line_count).toBe(5)

    const multi = await writeTemp(
      'multi.zip',
      makeZip([
        { name: 'a.log', data: SAMPLE_LOGCAT },
        { name: 'b.log', data: SAMPLE_LOGCAT },
        { name: 'image.png', data: Buffer.from('png') },
      ]),
    )
    expect(analyzer.scanFileMeta(multi).line_count).toBe(10)
  })

  it('reports zero lines and unknown format for an empty file', async () => {
    const target = await writeTemp('empty.log', '')
    const reference = analyzer.scanFileMeta(target)
    expect(reference.line_count).toBe(0)
    expect(reference.format_detected).toBe('unknown')
    expect(reference.truncated).toBe(false)
  })

  it('counts many lines', async () => {
    const content = `${Array.from({ length: 5000 }, (_, index) => `line ${index}`).join('\n')}\n`
    const target = await writeTemp('many.log', content)
    expect(analyzer.scanFileMeta(target).line_count).toBe(5000)
  })

  it('stops early at max_scan_lines', async () => {
    const content = `${Array.from({ length: 1000 }, (_, index) => `line ${index}`).join('\n')}\n`
    const target = await writeTemp('truncated.log', content)
    const reference = analyzer.scanFileMeta(target, 100)
    expect(reference.line_count).toBe(100)
    expect(reference.truncated).toBe(true)
  })

  it('flags truncated only at the exact boundary', async () => {
    const content = `${Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')}\n`
    const target = await writeTemp('boundary.log', content)
    expect(analyzer.scanFileMeta(target, 100)).toMatchObject({
      line_count: 100,
      truncated: true,
    })
    expect(analyzer.scanFileMeta(target, 101)).toMatchObject({
      line_count: 100,
      truncated: false,
    })
    expect(analyzer.scanFileMeta(target, 50000)).toMatchObject({
      line_count: 100,
      truncated: false,
    })
  })

  it('still detects the format when the scan is truncated', async () => {
    const target = await writeTemp('truncated-format.log', SAMPLE_LOGCAT.repeat(20))
    const reference = analyzer.scanFileMeta(target, 50)
    expect(reference.format_detected).toBe('android_logcat')
    expect(reference.line_count).toBe(50)
    expect(reference.truncated).toBe(true)
  })
})

describe('streamFile', () => {
  it('streams entries from a plain text file', async () => {
    const target = await writeTemp('stream.log', SAMPLE_LOGCAT)
    const entries = collect(analyzer.streamFile(target))
    expect(entries).toHaveLength(5)
    expect(entries.every((entry) => entry.line_number > 0)).toBe(true)
    expect(entries[0].level).toBe('E')
    expect(entries[0].tag).toBe('AndroidRuntime')
    expect(entries[0].source_file).toBe('stream.log')
  })

  it('streams entries from a gzip file', async () => {
    const target = await writeTemp('stream.log.gz', gzipSync(Buffer.from(SAMPLE_LOGCAT)))
    const entries = collect(analyzer.streamFile(target))
    expect(entries).toHaveLength(5)
    expect(entries[0].source_file).toBe('stream.log.gz')
  })

  it('streams entries from a zip file', async () => {
    const target = await writeTemp('stream.zip', makeZip([{ name: 'a.log', data: SAMPLE_LOGCAT }]))
    const entries = collect(analyzer.streamFile(target))
    expect(entries).toHaveLength(5)
    expect(entries[0].source_file).toBe('a.log')
  })

  it('streams every text member of a zip with continuous line numbers', async () => {
    const target = await writeTemp(
      'multi.zip',
      makeZip([
        { name: 'a.log', data: SAMPLE_LOGCAT },
        { name: 'b.log', data: SAMPLE_LOGCAT },
      ]),
    )
    const entries = collect(analyzer.streamFile(target))
    expect(entries).toHaveLength(10)
    expect(new Set(entries.map((entry) => entry.source_file))).toEqual(new Set(['a.log', 'b.log']))
    expect(entries.map((entry) => entry.line_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('yields lazily without consuming the whole file', async () => {
    const target = await writeTemp('lazy.log', SAMPLE_LOGCAT)
    const generator = analyzer.streamFile(target)
    const first = generator.next()
    const second = generator.next()
    expect(first.done).toBe(false)
    expect(second.done).toBe(false)
    expect(collect(generator)).toHaveLength(3)
  })

  it('skips blank lines while preserving their line numbers', async () => {
    const content = `01-15 10:30:45.123  1234  5678 E Tag: one\n\n\n01-15 10:30:45.124  1234  5678 I Tag: two\n`
    const target = await writeTemp('blank.log', content)
    const entries = collect(analyzer.streamFile(target))
    expect(entries.map((entry) => entry.line_number)).toEqual([1, 4])
  })

  it('splits CRLF and CR-only line endings like Python text mode', async () => {
    const crlf = await writeTemp(
      'crlf.log',
      '01-15 10:30:45.123  1234  5678 E Tag: one\r\n01-15 10:30:45.124  1234  5678 I Tag: two\r\n',
    )
    const crlfEntries = collect(analyzer.streamFile(crlf))
    expect(crlfEntries.map((entry) => entry.tag)).toEqual(['Tag', 'Tag'])
    expect(crlfEntries.map((entry) => entry.line_number)).toEqual([1, 2])

    const cr = await writeTemp(
      'cr.log',
      '01-15 10:30:45.123  1234  5678 E Tag: one\r01-15 10:30:45.124  1234  5678 I Tag: two\r',
    )
    const crEntries = collect(analyzer.streamFile(cr))
    expect(crEntries).toHaveLength(2)
    expect(crEntries[1].message).toBe('two')
    expect(analyzer.scanFileMeta(cr).line_count).toBe(2)
  })

  it('validates the path before streaming', () => {
    expect(() => analyzer.streamFile(join(directory, 'missing.log')).next()).toThrow(LogPathError)
  })
})

describe('examples/sample-android.log', () => {
  const samplePath = fileURLToPath(
    new URL('../../../../examples/sample-android.log', import.meta.url),
  )

  it('parses the bundled sample as android logcat', async () => {
    const content = await readFile(samplePath, 'utf8')
    const result = analyzer.parseLog(content, 'sample-android.log')
    expect(result.format_detected).toBe('android_logcat')
    expect(result.logs.length).toBeGreaterThan(0)
    expect(result.total_lines).toBe(result.logs.length)
    expect(result.logs.every((entry) => entry.source_file === 'sample-android.log')).toBe(true)
    expect(result.logs[0].tag).toBe('ActivityManager')
    expect(result.logs[0].pid).toBe('1234')
  })

  it('produces matching statistics', async () => {
    const content = await readFile(samplePath, 'utf8')
    const result = analyzer.parseLog(content)
    const stats = analyzer.getStatistics(result.logs)
    expect(stats.total).toBe(result.logs.length)
    expect(Object.values(stats.by_level).reduce((sum, count) => sum + count, 0)).toBe(stats.total)
    expect(Object.keys(stats.tags).length).toBeGreaterThan(0)
  })

  it('streams the same number of entries from disk', async () => {
    const content = await readFile(samplePath, 'utf8')
    const expected = analyzer.parseLog(content).logs.length
    expect(collect(analyzer.streamFile(samplePath))).toHaveLength(expected)
  })
})
