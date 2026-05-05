import { describe, it, expect } from 'vitest'
import { applyFiltersClient, computeStatistics } from '../App'
import { hasFilterConditions } from '../utils/filters'
import type { LogEntry, LogFilters } from '../types'

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

function defaultFilters(overrides: Partial<LogFilters> = {}): LogFilters {
  return {
    start_time: '',
    end_time: '',
    keywords: '',
    level: '',
    tag: '',
    pid: '',
    tid: '',
    tag_keyword_relation: 'AND',
    ...overrides,
  }
}

// ── applyFiltersClient ─────────────────────────────────────────────────────

describe('applyFiltersClient', () => {
  // AC12: Empty filters return all logs
  it('returns all logs with empty filters', () => {
    const logs = [makeLog({ line_number: 1 }), makeLog({ line_number: 2 })]
    const result = applyFiltersClient(logs, defaultFilters())
    expect(result).toEqual(logs)
    expect(result).toHaveLength(2)
  })

  // AC2: time range — start_time
  it('filters by start_time', () => {
    const logs = [
      makeLog({ line_number: 1, timestamp: '12:00:00' }),
      makeLog({ line_number: 2, timestamp: '14:00:00' }),
      makeLog({ line_number: 3, timestamp: '13:30:00' }),
    ]
    const filters = defaultFilters({ start_time: '13:00:00' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(2)
    expect(result.map((l) => l.line_number)).toEqual([2, 3])
  })

  // AC2: time range — end_time
  it('filters by end_time', () => {
    const logs = [
      makeLog({ line_number: 1, timestamp: '12:00:00' }),
      makeLog({ line_number: 2, timestamp: '14:00:00' }),
      makeLog({ line_number: 3, timestamp: '13:30:00' }),
    ]
    const filters = defaultFilters({ end_time: '13:00:00' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].line_number).toBe(1)
  })

  // AC2: time range — both start and end
  it('filters by both start_time and end_time', () => {
    const logs = [
      makeLog({ line_number: 1, timestamp: '12:00:00' }),
      makeLog({ line_number: 2, timestamp: '13:00:00' }),
      makeLog({ line_number: 3, timestamp: '14:00:00' }),
    ]
    const filters = defaultFilters({ start_time: '12:30:00', end_time: '13:30:00' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].line_number).toBe(2)
  })

  // AC2: null timestamp always passes time filters
  it('lets null timestamps pass time filters', () => {
    const logs = [
      makeLog({ line_number: 1, timestamp: null }),
      makeLog({ line_number: 2, timestamp: '10:00:00' }),
    ]
    const filters = defaultFilters({ start_time: '12:00:00' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].line_number).toBe(1)
  })

  // AC3: level filter — exact match
  it('filters by level exact match', () => {
    const logs = [
      makeLog({ line_number: 1, level: 'I' }),
      makeLog({ line_number: 2, level: 'E' }),
      makeLog({ line_number: 3, level: 'W' }),
    ]
    const filters = defaultFilters({ level: 'E' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].level).toBe('E')
  })

  // AC4: PID filter — exact match
  it('filters by pid exact match', () => {
    const logs = [
      makeLog({ line_number: 1, pid: '100' }),
      makeLog({ line_number: 2, pid: '200' }),
      makeLog({ line_number: 3, pid: '100' }),
    ]
    const filters = defaultFilters({ pid: '100' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(2)
    expect(result.every((l) => l.pid === '100')).toBe(true)
  })

  // AC4: TID filter — exact match
  it('filters by tid exact match', () => {
    const logs = [
      makeLog({ line_number: 1, tid: '300' }),
      makeLog({ line_number: 2, tid: '400' }),
    ]
    const filters = defaultFilters({ tid: '300' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].tid).toBe('300')
  })

  // AC5: keyword regex filter (matches message and raw_line)
  it('filters by keyword regex matching message', () => {
    const logs = [
      makeLog({ line_number: 1, message: 'Error occurred', raw_line: 'Error occurred' }),
      makeLog({ line_number: 2, message: 'OK' }),
      makeLog({ line_number: 3, message: 'Critical error here', raw_line: 'raw' }),
    ]
    const filters = defaultFilters({ keywords: 'error' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(2)
    expect(result.map((l) => l.line_number)).toEqual([1, 3])
  })

  it('filters by keyword regex matching raw_line', () => {
    const logs = [
      makeLog({
        line_number: 1,
        message: 'No match',
        raw_line: 'matched ERROR in raw',
      }),
      makeLog({ line_number: 2, message: 'clean', raw_line: 'clean' }),
    ]
    const filters = defaultFilters({ keywords: 'ERROR' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].line_number).toBe(1)
  })

  // AC6: tag regex filter
  it('filters by tag regex', () => {
    const logs = [
      makeLog({ line_number: 1, tag: 'ActivityManager' }),
      makeLog({ line_number: 2, tag: 'PackageManager' }),
      makeLog({ line_number: 3, tag: 'SurfaceFlinger' }),
    ]
    const filters = defaultFilters({ tag: 'Manager' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(2)
    expect(result.map((l) => l.tag)).toEqual(['ActivityManager', 'PackageManager'])
  })

  // AC7: AND relation — both keyword and tag must match
  it('applies AND relation between keyword and tag', () => {
    const logs = [
      makeLog({ line_number: 1, tag: 'Crash', message: 'NullPointerException' }),
      makeLog({ line_number: 2, tag: 'Network', message: 'Timeout error' }),
      makeLog({ line_number: 3, tag: 'Crash', message: 'Timeout in render' }),
    ]
    const filters = defaultFilters({
      keywords: 'error|exception',
      tag: 'Crash',
      tag_keyword_relation: 'AND',
    })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].line_number).toBe(1) // tag=Crash + message has Exception
  })

  // AC8: OR relation — either keyword or tag matches
  it('applies OR relation between keyword and tag', () => {
    const logs = [
      makeLog({ line_number: 1, tag: 'Crash', message: 'rendering OK' }),
      makeLog({ line_number: 2, tag: 'Network', message: 'Timeout error' }),
      makeLog({ line_number: 3, tag: 'UI', message: 'rendering OK' }),
    ]
    const filters = defaultFilters({
      keywords: 'error',
      tag: 'Crash',
      tag_keyword_relation: 'OR',
    })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(2)
    expect(result.map((l) => l.line_number)).toEqual([1, 2])
  })

  // AC9: keyword-only filtering (no tag)
  it('filters by keyword only when no tag', () => {
    const logs = [
      makeLog({ line_number: 1, message: 'Fatal Exception' }),
      makeLog({ line_number: 2, message: 'OK' }),
    ]
    const filters = defaultFilters({ keywords: 'fatal' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].line_number).toBe(1)
  })

  // AC10: tag-only filtering (no keyword)
  it('filters by tag only when no keyword', () => {
    const logs = [
      makeLog({ line_number: 1, tag: 'MyTag' }),
      makeLog({ line_number: 2, tag: 'OtherTag' }),
    ]
    const filters = defaultFilters({ tag: 'My' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].tag).toBe('MyTag')
  })

  // AC11: invalid keyword regex — silently falls back (no filter on keyword dim)
  it('falls back on invalid keyword regex', () => {
    const logs = [
      makeLog({ line_number: 1, message: 'anything' }),
      makeLog({ line_number: 2, message: 'else' }),
    ]
    const filters = defaultFilters({ keywords: '[invalid(' })
    const result = applyFiltersClient(logs, filters)
    // Invalid regex → keywordRe = null → no keyword filter applied
    // Without other active filters, all logs should pass
    expect(result).toHaveLength(2)
  })

  // AC11: invalid tag regex — silently falls back
  it('falls back on invalid tag regex', () => {
    const logs = [
      makeLog({ line_number: 1, tag: 'TagA' }),
      makeLog({ line_number: 2, tag: 'TagB' }),
    ]
    const filters = defaultFilters({ tag: '[invalid(' })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(2)
  })

  // AC12: does not mutate original array
  it('does not mutate the original array', () => {
    const logs = [makeLog({ line_number: 1 }), makeLog({ line_number: 2 })]
    const originalLength = logs.length
    applyFiltersClient(logs, defaultFilters({ level: 'E' }))
    expect(logs).toHaveLength(originalLength)
    expect(logs[0].level).toBe('I')
  })

  // Additional: combined filters
  it('applies multiple filters simultaneously', () => {
    const logs = [
      makeLog({
        line_number: 1,
        level: 'E',
        pid: '100',
        tid: '200',
        timestamp: '14:00:00',
        message: 'crash detected',
      }),
      makeLog({
        line_number: 2,
        level: 'E',
        pid: '100',
        tid: '300',
        timestamp: '14:05:00',
        message: 'OK',
      }),
      makeLog({
        line_number: 3,
        level: 'I',
        pid: '100',
        tid: '200',
        timestamp: '14:00:00',
        message: 'info',
      }),
    ]
    const filters = defaultFilters({
      level: 'E',
      pid: '100',
      tid: '200',
      keywords: 'crash',
    })
    const result = applyFiltersClient(logs, filters)
    expect(result).toHaveLength(1)
    expect(result[0].line_number).toBe(1)
  })
})

// ── computeStatistics ──────────────────────────────────────────────────────

describe('computeStatistics', () => {
  // AC13: correct level distribution, tag frequency, pid frequency
  it('computes correct statistics for normal logs', () => {
    const logs = [
      makeLog({ line_number: 1, level: 'I', tag: 'TagA', pid: '100' }),
      makeLog({ line_number: 2, level: 'E', tag: 'TagA', pid: '100' }),
      makeLog({ line_number: 3, level: 'I', tag: 'TagB', pid: '200' }),
    ]
    const stats = computeStatistics(logs)
    expect(stats.total).toBe(3)
    expect(stats.by_level).toEqual({ I: 2, E: 1 })
    expect(stats.tags).toEqual({ TagA: 2, TagB: 1 })
    expect(stats.pids).toEqual({ '100': 2, '200': 1 })
  })

  // AC14: empty array → zeroed statistics
  it('returns zeroed statistics for empty array', () => {
    const stats = computeStatistics([])
    expect(stats).toEqual({ total: 0, by_level: {}, tags: {}, pids: {} })
  })

  // Additional: handles null pid
  it('skips null pid in pid count', () => {
    const logs = [
      makeLog({ line_number: 1, pid: null, level: 'I', tag: 'T' }),
      makeLog({ line_number: 2, pid: '100', level: 'W', tag: 'T' }),
    ]
    const stats = computeStatistics(logs)
    expect(stats.pids).toEqual({ '100': 1 })
  })

  // Additional: single entry
  it('handles single entry', () => {
    const logs = [makeLog({ line_number: 1, level: 'F', tag: 'Crash', pid: '1' })]
    const stats = computeStatistics(logs)
    expect(stats.total).toBe(1)
    expect(stats.by_level).toEqual({ F: 1 })
    expect(stats.tags).toEqual({ Crash: 1 })
    expect(stats.pids).toEqual({ '1': 1 })
  })
})

// ── hasFilterConditions ────────────────────────────────────────────────────

describe('hasFilterConditions', () => {
  // AC15: correctly detects active filter conditions
  it('returns false for default/empty filters', () => {
    expect(hasFilterConditions(defaultFilters())).toBe(false)
  })

  it('returns true when start_time is set', () => {
    expect(hasFilterConditions(defaultFilters({ start_time: '12:00:00' }))).toBe(true)
  })

  it('returns true when end_time is set', () => {
    expect(hasFilterConditions(defaultFilters({ end_time: '12:00:00' }))).toBe(true)
  })

  it('returns true when keywords is set', () => {
    expect(hasFilterConditions(defaultFilters({ keywords: 'error' }))).toBe(true)
  })

  it('returns true when level is set', () => {
    expect(hasFilterConditions(defaultFilters({ level: 'E' }))).toBe(true)
  })

  it('returns true when tag is set', () => {
    expect(hasFilterConditions(defaultFilters({ tag: 'Crash' }))).toBe(true)
  })

  it('returns true when pid is set', () => {
    expect(hasFilterConditions(defaultFilters({ pid: '100' }))).toBe(true)
  })

  it('returns true when tid is set', () => {
    expect(hasFilterConditions(defaultFilters({ tid: '200' }))).toBe(true)
  })

  it('is not affected by tag_keyword_relation', () => {
    // tag_keyword_relation is a combinator, not a filter condition
    expect(hasFilterConditions(defaultFilters({ tag_keyword_relation: 'OR' }))).toBe(false)
    expect(hasFilterConditions(defaultFilters({ keywords: 'x', tag_keyword_relation: 'OR' }))).toBe(true)
  })

  it('returns false for whitespace-only keywords or tag', () => {
    expect(hasFilterConditions(defaultFilters({ keywords: '   ' }))).toBe(false)
    expect(hasFilterConditions(defaultFilters({ tag: '\t' }))).toBe(false)
  })
})
