import { apiUpload } from './client'
import type { TraceParseResult } from '../types'

export async function parseTrace(file: File): Promise<TraceParseResult> {
  return apiUpload<TraceParseResult>('/trace/parse', file)
}
