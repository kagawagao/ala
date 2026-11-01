/**
 * Android log analyzer — public entry point.
 *
 * TypeScript port of ``backend/src/ala/services/log_analyzer.py``. All wire
 * field names stay in snake_case to match the Python dataclasses and the
 * backend's NDJSON payloads.
 *
 * ```ts
 * const analyzer = new LogAnalyzer()
 * const result = analyzer.parseLog(text, 'logcat.log')
 * const errors = result.logs.filter(createLogFilter({ level: 'E' }))
 * ```
 */
export type {
  FileRef,
  LogEntry,
  LogFilters,
  LogFormat,
  LogStatistics,
  ParseResult,
} from './types.ts'
export { LogPathError } from './errors.ts'
export type { LogPathErrorCode } from './errors.ts'
export { createLogFilter } from './filter.ts'
export { extractTextFiles } from './archives.ts'
export type { ExtractedTextFile } from './archives.ts'
export { LogAnalyzer } from './analyzer.ts'
