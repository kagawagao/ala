import { apiFetch, apiUpload } from './client'
import type { LogEntry, LogFilters, LogStatistics, ParseResult } from '../types'

export async function parseLog(file: File): Promise<ParseResult> {
  return apiUpload<ParseResult>('/logs/parse', file)
}

export async function filterLogs(logs: LogEntry[], filters: Partial<LogFilters>): Promise<LogEntry[]> {
  return apiFetch<LogEntry[]>('/logs/filter', {
    method: 'POST',
    body: JSON.stringify({ logs, filters }),
  })
}

export async function getStatistics(logs: LogEntry[]): Promise<LogStatistics> {
  return apiFetch<LogStatistics>('/logs/statistics', {
    method: 'POST',
    body: JSON.stringify(logs),
  })
}
