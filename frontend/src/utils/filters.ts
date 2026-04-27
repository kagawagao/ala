import type { LogFilters } from '../types'

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
