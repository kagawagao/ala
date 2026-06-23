import type { PcapEntry, PcapFilters, PcapStatistics } from '../types/pcap'
import { apiFetch, apiUploadMulti, streamNDJSON } from './client'

// ── Temp upload / status ──────────────────────────────────────────────

export interface PcapTempFileInfo {
  original_name: string
  saved_path: string
  size_bytes: number
  format_detected: string
}

export interface PcapTempUploadResponse {
  session_uuid: string
  files: PcapTempFileInfo[]
}

export interface PcapTempStatusResponse {
  dir_path: string
  session_count: number
  total_size_bytes: number
}

export async function uploadPcapToTemp(files: File[]): Promise<PcapTempUploadResponse> {
  return apiUploadMulti<PcapTempUploadResponse>('/pcap/upload/temp', files)
}

export async function getPcapTempStatus(): Promise<PcapTempStatusResponse> {
  return apiFetch<PcapTempStatusResponse>('/pcap/temp/status')
}

export async function cleanupPcapTemp(): Promise<{ removed: number }> {
  return apiFetch<{ removed: number }>('/pcap/temp/cleanup', { method: 'POST' })
}

// ── Stream types ──────────────────────────────────────────────────────

interface StreamDone {
  _done: true
  matched: number
  scanned: number
  stats: PcapStatistics
}

interface StreamError {
  _error: string
}

type StreamLine = PcapEntry | StreamDone | StreamError

const isDone = (line: StreamLine): line is StreamDone => '_done' in line
const isError = (line: StreamLine): line is StreamError => '_error' in line

// ── Lazy filter/stream ────────────────────────────────────────────────

export interface PcapFilterStreamResult {
  entries: PcapEntry[]
  stats: PcapStatistics | null
  matched: number
  scanned: number
}

export async function* streamFilteredPcap(
  path: string,
  filters: PcapFilters,
  signal?: AbortSignal,
): AsyncGenerator<PcapEntry | StreamDone | StreamError> {
  const generator = streamNDJSON<StreamLine>('/pcap/filter/stream', { path, filters }, signal)
  for await (const line of generator) {
    if (isError(line)) {
      throw new Error(line._error)
    }
    yield line
    if (isDone(line)) return
  }
}
