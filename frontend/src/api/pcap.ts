import type { PcapEntry, PcapFilters, PcapParseResult, PcapStatistics } from '../types/pcap'
import { apiFetch, apiUploadMulti } from './client'

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

// ── Legacy (kept for backward compat) ─────────────────────────────────

export async function parsePcap(file: File): Promise<PcapParseResult> {
  const formData = new FormData()
  formData.append('file', file)
  return apiFetch<PcapParseResult>('/pcap/parse', {
    method: 'POST',
    body: formData,
  })
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
  const response = await fetch('/api/pcap/filter/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, filters }),
    signal,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `${response.status}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Process complete lines from buffer
      let newlineIdx: number
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)

        if (!line) continue

        try {
          const parsed: StreamLine = JSON.parse(line)
          if (isError(parsed)) {
            throw new Error(parsed._error)
          }
          yield parsed
          if (isDone(parsed)) return
        } catch (e) {
          if (e instanceof SyntaxError) continue
          throw e
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── Legacy filter (kept for backward compat) ───────────────────────────

export async function filterPcap(entries: PcapEntry[], filters: PcapFilters): Promise<PcapEntry[]> {
  const body = JSON.stringify({ entries, filters })
  return apiFetch<PcapEntry[]>('/pcap/filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
}

export async function getPcapStatistics(entries: PcapEntry[]): Promise<PcapStatistics> {
  return apiFetch<PcapStatistics>('/pcap/statistics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  })
}
