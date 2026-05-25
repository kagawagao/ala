import { apiUploadMulti } from './client'

export interface UnifiedFileInfo {
  original_name: string
  saved_path: string | null
  size_bytes: number
  file_type: 'log' | 'pcap' | 'hci' | 'trace'
  format_detected: string
  trace_result?: {
    summary: {
      duration_ms: number | null
      process_count: number
      thread_count: number
      event_count: number
      processes: Record<string, unknown>[]
      top_slices: Record<string, unknown>[]
      ftrace_events: string[]
      metadata: Record<string, unknown>
    }
    format: string
    file_size: number
  } | null
}

export interface UnifiedUploadResponse {
  session_uuid: string
  files: UnifiedFileInfo[]
}

export async function uploadFiles(files: File[]): Promise<UnifiedUploadResponse> {
  return apiUploadMulti<UnifiedUploadResponse>('/files/upload', files)
}
