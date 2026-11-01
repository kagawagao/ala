/**
 * Wire types for the log analyzer.
 *
 * Field names intentionally stay in snake_case: they mirror the Python
 * dataclasses (and the NDJSON payloads served by the FastAPI backend) so the
 * same JSON can flow through both implementations unchanged.
 */

export type LogFormat = 'android_logcat' | 'generic_timestamped' | 'unknown'

export interface LogEntry {
  line_number: number
  timestamp: string | null
  pid: string | null
  tid: string | null
  level: string
  tag: string
  message: string
  raw_line: string
  source_file: string | null
}

export interface LogFilters {
  start_time?: string | null
  end_time?: string | null
  keywords?: string | null
  level?: string | null
  tag?: string | null
  pid?: string | null
  tid?: string | null
  tag_keyword_relation?: 'AND' | 'OR' | string | null
}

export interface LogStatistics {
  total: number
  by_level: Record<string, number>
  tags: Record<string, number>
  pids: Record<string, number>
}

export interface ParseResult {
  logs: LogEntry[]
  total_lines: number
  format_detected: LogFormat
}

export interface FileRef {
  path: string
  line_count: number
  size_bytes: number
  format_detected: LogFormat
  is_gzip: boolean
  is_zip: boolean
  truncated: boolean
}
