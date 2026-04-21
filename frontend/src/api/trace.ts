import { apiFetch, apiUpload } from './client'
import type { TraceFilterRequest, TraceParseResult } from '../types'

export async function parseTrace(file: File): Promise<TraceParseResult> {
  return apiUpload<TraceParseResult>('/trace/parse', file)
}

/**
 * Filter an already-parsed trace result by process PID(s) and/or name.
 *
 * Pass the original ``TraceParseResult`` plus filter criteria; the backend
 * returns a new result containing only the matching processes.
 */
export async function filterTrace(req: TraceFilterRequest): Promise<TraceParseResult> {
  return apiFetch<TraceParseResult>('/trace/filter', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}
