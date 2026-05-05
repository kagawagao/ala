import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateCSV, generateJSON, downloadBlob, generateExportFilename } from '../export'
import type { LogEntry } from '../../types'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLog(overrides: Partial<LogEntry> & { line_number: number }): LogEntry {
  return {
    line_number: overrides.line_number,
    timestamp: overrides.timestamp ?? null,
    level: overrides.level ?? 'I',
    tag: overrides.tag ?? 'TestTag',
    pid: overrides.pid ?? null,
    tid: overrides.tid ?? null,
    message: overrides.message ?? `Message ${overrides.line_number}`,
    raw_line: overrides.raw_line ?? `raw line ${overrides.line_number}`,
    source_file: overrides.source_file ?? null,
  }
}

// ── generateCSV ────────────────────────────────────────────────────────────

describe('generateCSV', () => {
  it('generates correct CSV with header and BOM', () => {
    const logs = [
      makeLog({
        line_number: 1,
        timestamp: '12:00:00.000',
        level: 'I',
        tag: 'MyTag',
        pid: '100',
        tid: '200',
        message: 'Hello',
      }),
    ]
    const csv = generateCSV(logs)
    expect(csv.charCodeAt(0)).toBe(0xfeff) // BOM prefix
    const lines = csv.slice(1).trim().split('\n')
    expect(lines[0]).toBe('line_number,timestamp,level,tag,pid,tid,message')
    expect(lines[1]).toBe('1,12:00:00.000,I,MyTag,100,200,Hello')
  })

  it('generates CSV with multiple rows', () => {
    const logs = [
      makeLog({ line_number: 1, message: 'First' }),
      makeLog({ line_number: 2, message: 'Second' }),
    ]
    const csv = generateCSV(logs)
    const lines = csv.replace('\uFEFF', '').trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 rows
    expect(lines[1]).toContain('First')
    expect(lines[2]).toContain('Second')
  })

  it('handles empty logs array', () => {
    const csv = generateCSV([])
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const lines = csv.slice(1).trim().split('\n')
    expect(lines).toHaveLength(1) // header only
    expect(lines[0]).toBe('line_number,timestamp,level,tag,pid,tid,message')
  })

  it('escapes commas in CSV values per RFC 4180', () => {
    const logs = [
      makeLog({
        line_number: 1,
        message: 'Hello, world',
      }),
    ]
    const csv = generateCSV(logs)
    const lines = csv.replace('\uFEFF', '').trim().split('\n')
    // The message should be wrapped in double quotes
    expect(lines[1]).toContain('"Hello, world"')
  })

  it('escapes double quotes in CSV values', () => {
    const logs = [
      makeLog({
        line_number: 1,
        message: 'He said "hello"',
      }),
    ]
    const csv = generateCSV(logs)
    const lines = csv.replace('\uFEFF', '').trim().split('\n')
    // Double-quotes doubled inside quoted field
    expect(lines[1]).toContain('"He said ""hello"""')
  })

  it('escapes newlines in CSV values', () => {
    const logs = [
      makeLog({
        line_number: 1,
        message: 'Line 1\nLine 2',
      }),
    ]
    const csv = generateCSV(logs)
    const body = csv.replace('\uFEFF', '')
    // The message with embedded newline should be quoted (check raw CSV before newline split)
    expect(body).toContain('"Line 1\nLine 2"')
  })

  it('handles null values as empty strings', () => {
    const logs = [
      makeLog({
        line_number: 1,
        timestamp: null,
        pid: null,
        tid: null,
        message: 'test',
      }),
    ]
    const csv = generateCSV(logs)
    const lines = csv.replace('\uFEFF', '').trim().split('\n')
    // Null values should appear as empty fields (,,)
    expect(lines[1]).toBe('1,,I,TestTag,,,test')
  })
})

// ── generateJSON ───────────────────────────────────────────────────────────

describe('generateJSON', () => {
  it('generates valid JSON array with 2-space indent', () => {
    const logs = [
      makeLog({ line_number: 1, level: 'I', message: 'Hello' }),
      makeLog({ line_number: 2, level: 'E', message: 'Error' }),
    ]
    const json = generateJSON(logs)
    const parsed = JSON.parse(json)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].line_number).toBe(1)
    expect(parsed[1].line_number).toBe(2)
    // Verify 2-space indent
    expect(json).toContain('  ')
    expect(json).not.toContain('\t')
  })

  it('generates empty JSON array for empty logs', () => {
    const json = generateJSON([])
    expect(json).toBe('[]')
  })

  it('preserves all LogEntry fields in JSON', () => {
    const log = makeLog({
      line_number: 1,
      timestamp: '12:00:00',
      level: 'W',
      tag: 'WarningTag',
      pid: '123',
      tid: '456',
      message: 'Warning!',
      raw_line: 'raw warning',
      source_file: '/path/to/file.log',
    })
    const json = generateJSON([log])
    const parsed = JSON.parse(json)
    expect(parsed[0].line_number).toBe(1)
    expect(parsed[0].timestamp).toBe('12:00:00')
    expect(parsed[0].level).toBe('W')
    expect(parsed[0].tag).toBe('WarningTag')
    expect(parsed[0].pid).toBe('123')
    expect(parsed[0].tid).toBe('456')
    expect(parsed[0].message).toBe('Warning!')
    expect(parsed[0].raw_line).toBe('raw warning')
    expect(parsed[0].source_file).toBe('/path/to/file.log')
  })
})

// ── downloadBlob ───────────────────────────────────────────────────────────

describe('downloadBlob', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // jsdom may not have URL.createObjectURL; stub it
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('creates Blob, URL, anchor, triggers click, and cleans up', () => {
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')

    let clickFired = false
    const mockAnchor = {
      href: '',
      download: '',
      click: () => {
        clickFired = true
      },
    } as unknown as HTMLAnchorElement

    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor)
    // jsdom's appendChild/removeChild checks for real Node type — use fn() mocks
    const appendChildFn = vi.fn()
    const removeChildFn = vi.fn()
    vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildFn)
    vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildFn)
    vi.useFakeTimers()

    downloadBlob('test content', 'test.csv', 'text/csv')

    expect(mockAnchor.download).toBe('test.csv')
    expect(mockAnchor.href).toBe('blob:test')
    expect(clickFired).toBe(true)
    expect(appendChildFn).toHaveBeenCalledWith(mockAnchor)
    expect(removeChildFn).toHaveBeenCalledWith(mockAnchor)

    vi.advanceTimersByTime(100)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test')

    vi.useRealTimers()
  })
})

// ── generateExportFilename ─────────────────────────────────────────────────

describe('generateExportFilename', () => {
  it('generates filename with correct CSV extension', () => {
    const filename = generateExportFilename('csv')
    expect(filename).toMatch(/^ala-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/)
  })

  it('generates filename with correct JSON extension', () => {
    const filename = generateExportFilename('json')
    expect(filename).toMatch(/^ala-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/)
  })
})
