import type { LogEntry, LogFilters, LogStatistics } from '../types'

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
  let result = logs

  if (filters.start_time) {
    result = result.filter((l) => !l.timestamp || l.timestamp >= filters.start_time)
  }
  if (filters.end_time) {
    result = result.filter((l) => !l.timestamp || l.timestamp <= filters.end_time)
  }
  if (filters.level) {
    result = result.filter((l) => l.level === filters.level)
  }
  if (filters.pid) {
    result = result.filter((l) => l.pid === filters.pid)
  }
  if (filters.tid) {
    result = result.filter((l) => l.tid === filters.tid)
  }

  const hasKeyword = filters.keywords.trim() !== ''
  const hasTag = filters.tag.trim() !== ''

  if (hasKeyword || hasTag) {
    let keywordRe: RegExp | null = null
    let tagRe: RegExp | null = null

    if (hasKeyword) {
      try {
        keywordRe = new RegExp(filters.keywords, 'i')
      } catch {
        keywordRe = null
      }
    }
    if (hasTag) {
      try {
        tagRe = new RegExp(filters.tag, 'i')
      } catch {
        tagRe = null
      }
    }

    // Silently fall back when regex is invalid — treat as if no filter on that dimension
    const effectiveHasKeyword = hasKeyword && keywordRe !== null
    const effectiveHasTag = hasTag && tagRe !== null

    if (effectiveHasKeyword || effectiveHasTag) {
      result = result.filter((l) => {
        const matchesKeyword = keywordRe
          ? keywordRe.test(l.message) || keywordRe.test(l.raw_line)
          : false
        const matchesTag = tagRe ? tagRe.test(l.tag) : false

        if (effectiveHasKeyword && effectiveHasTag) {
          return filters.tag_keyword_relation === 'AND'
            ? matchesKeyword && matchesTag
            : matchesKeyword || matchesTag
        }
        if (effectiveHasKeyword) return matchesKeyword
        if (effectiveHasTag) return matchesTag
        return true
      })
    }
  }

  return result
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
