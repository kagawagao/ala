/**
 * Log filtering, ported from ``LogAnalyzer.filter_logs``.
 *
 * ``createLogFilter`` compiles the keyword/tag patterns once and returns a
 * predicate, so streaming callers can filter millions of entries without
 * recompiling anything per line. ``filterLogs`` is just ``Array#filter`` with
 * that predicate.
 */
import type { LogEntry, LogFilters } from './types.ts'

type TextMatcher = (text: string) => boolean

function buildMatcher(pattern: string | null | undefined): TextMatcher | null {
  if (!pattern || !pattern.trim()) return null
  try {
    const regex = new RegExp(pattern, 'i')
    return (text: string) => regex.test(text)
  } catch {
    // Python falls back to a case-insensitive substring match when the
    // pattern is not a valid regular expression; mirror that.
    const needle = pattern.toLowerCase()
    return (text: string) => text.toLowerCase().includes(needle)
  }
}

/**
 * Precompile `filters` into a predicate with the exact semantics of
 * ``LogAnalyzer.filter_logs``.
 */
export function createLogFilter(filters: LogFilters): (entry: LogEntry) => boolean {
  const matchesKeyword = buildMatcher(filters.keywords)
  const matchesTag = buildMatcher(filters.tag)
  const useOr = filters.tag_keyword_relation === 'OR'

  const startTime = filters.start_time || null
  const endTime = filters.end_time || null
  const level = filters.level || null
  const pid = filters.pid || null
  const tid = filters.tid || null
  const usePid = pid !== null && pid.trim() !== ''
  const useTid = tid !== null && tid.trim() !== ''

  return (entry: LogEntry): boolean => {
    // Time filter
    if (startTime || endTime) {
      if (!entry.timestamp) return false
      if (startTime && entry.timestamp < startTime) return false
      if (endTime && entry.timestamp > endTime) return false
    }

    // Keyword + tag filter
    if (matchesKeyword || matchesTag) {
      const keywordMatch = matchesKeyword
        ? matchesKeyword(entry.message) || matchesKeyword(entry.raw_line)
        : true
      const tagMatch = matchesTag ? matchesTag(entry.tag) : true

      if (useOr && matchesKeyword && matchesTag) {
        if (!(keywordMatch || tagMatch)) return false
      } else if (!(keywordMatch && tagMatch)) {
        return false
      }
    }

    // Level filter
    if (level && level !== 'ALL' && entry.level !== level) return false

    // PID filter
    if (usePid && entry.pid !== pid) return false

    // TID filter
    if (useTid && entry.tid !== tid) return false

    return true
  }
}
