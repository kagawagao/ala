import type { HciEntry, HciFilters, HciParseResult, HciStatistics } from '../types/hci'
import { apiFetch, apiUploadMulti, streamNDJSON } from './client'

// ── Temp upload / status ──────────────────────────────────────────────

export interface HciTempFileInfo {
  original_name: string
  saved_path: string
  size_bytes: number
  format_detected: string
}

export interface HciTempUploadResponse {
  session_uuid: string
  files: HciTempFileInfo[]
}

export interface HciTempStatusResponse {
  dir_path: string
  session_count: number
  total_size_bytes: number
}

export async function uploadHciToTemp(files: File[]): Promise<HciTempUploadResponse> {
  return apiUploadMulti<HciTempUploadResponse>('/hci/upload/temp', files)
}

export async function getHciTempStatus(): Promise<HciTempStatusResponse> {
  return apiFetch<HciTempStatusResponse>('/hci/temp/status')
}

export async function cleanupHciTemp(): Promise<{ removed: number }> {
  return apiFetch<{ removed: number }>('/hci/temp/cleanup', { method: 'POST' })
}

// ── Legacy (kept for backward compat) ─────────────────────────────────

export async function parseHci(file: File): Promise<HciParseResult> {
  const formData = new FormData()
  formData.append('file', file)
  return apiFetch<HciParseResult>('/hci/parse', {
    method: 'POST',
    body: formData,
  })
}

// ── Stream types ──────────────────────────────────────────────────────

interface StreamDone {
  _done: true
  matched: number
  scanned: number
  stats: HciStatistics
}

interface StreamError {
  _error: string
}

type StreamLine = HciEntry | StreamDone | StreamError

const isDone = (line: StreamLine): line is StreamDone => '_done' in line
const isError = (line: StreamLine): line is StreamError => '_error' in line

// ── Lazy filter/stream ────────────────────────────────────────────────

export interface HciFilterStreamResult {
  entries: HciEntry[]
  stats: HciStatistics | null
  matched: number
  scanned: number
}

export async function* streamFilteredHci(
  path: string,
  filters: HciFilters,
  signal?: AbortSignal,
): AsyncGenerator<HciEntry | StreamDone | StreamError> {
  const generator = streamNDJSON<StreamLine>('/hci/filter/stream', { path, filters }, signal)
  for await (const line of generator) {
    if (isError(line)) {
      throw new Error(line._error)
    }
    yield line
    if (isDone(line)) return
  }
}

// ── Legacy filter (kept for backward compat) ───────────────────────────

export async function filterHci(entries: HciEntry[], filters: HciFilters): Promise<HciEntry[]> {
  const body = JSON.stringify({ entries, filters })
  return apiFetch<HciEntry[]>('/hci/filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

export async function getHciStatistics(entries: HciEntry[]): Promise<HciStatistics> {
  return apiFetch<HciStatistics>('/hci/statistics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  })
}
