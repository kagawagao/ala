import type { LogEntry, LogFilters, LogStatistics } from '../types'

function hasRegexMetaChars(value: string): boolean {
  return /[\\^$.*+?()[\]{}|]/.test(value)
}

function createMatcher(value: string): ((text: string) => boolean) | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (!hasRegexMetaChars(trimmed)) {
    const lower = trimmed.toLowerCase()
    return (text: string) => text.toLowerCase().includes(lower)
  }

  try {
    const regex = new RegExp(trimmed, 'i')
    return (text: string) => regex.test(text)
  } catch {
    return undefined
  }
}

/**
 * Returns true when at least one filter condition field contains a non-default value.
 * The `tag_keyword_relation` field is intentionally excluded as it is a combinator,
 * not a filter condition in itself.
 */
export function hasFilterConditions(filters: LogFilters): boolean {
  return (
    filters.start_time !== '' ||
    filters.end_time !== '' ||
    filters.keywords.trim() !== '' ||
    filters.level !== '' ||
    filters.tag.trim() !== '' ||
    filters.pid !== '' ||
    filters.tid !== ''
  )
}

export function applyFiltersClient(logs: LogEntry[], filters: LogFilters): LogEntry[] {
  const keywordMatcher = createMatcher(filters.keywords)
  const tagMatcher = createMatcher(filters.tag)
  const hasKeyword = keywordMatcher !== undefined
  const hasTag = tagMatcher !== undefined
  const useAndRelation = filters.tag_keyword_relation !== 'OR'

  return logs.filter((log) => {
    if (filters.start_time && log.timestamp && log.timestamp < filters.start_time) {
      return false
    }
    if (filters.end_time && log.timestamp && log.timestamp > filters.end_time) {
      return false
    }
    if (filters.level && log.level !== filters.level) {
      return false
    }
    if (filters.pid && log.pid !== filters.pid) {
      return false
    }
    if (filters.tid && log.tid !== filters.tid) {
      return false
    }

    if (hasKeyword || hasTag) {
      const keywordMatch = keywordMatcher
      const tagMatch = tagMatcher
      const matchesKeyword = hasKeyword
        ? keywordMatch!(log.message) || keywordMatch!(log.raw_line)
        : false
      const matchesTag = hasTag ? tagMatch!(log.tag) : false

      if (hasKeyword && hasTag) {
        return useAndRelation ? matchesKeyword && matchesTag : matchesKeyword || matchesTag
      }
      if (hasKeyword) return matchesKeyword
      if (hasTag) return matchesTag
    }

    return true
  })
}

export function computeStatistics(logs: LogEntry[]): LogStatistics {
  const by_level: Record<string, number> = {}
  const tags: Record<string, number> = {}
  const pids: Record<string, number> = {}

  for (const log of logs) {
    by_level[log.level] = (by_level[log.level] || 0) + 1
    tags[log.tag] = (tags[log.tag] || 0) + 1
    if (log.pid) pids[log.pid] = (pids[log.pid] || 0) + 1
  }

  return { total: logs.length, by_level, tags, pids }
}
