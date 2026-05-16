import type { PcapEntry, PcapFilters, PcapParseResult, PcapStatistics } from '../types/pcap'
import { apiUpload, streamUploadNDJSON } from './client'

export async function parsePcap(file: File): Promise<PcapParseResult> {
  return apiUpload<PcapParseResult>('/api/pcap/parse', file)
}

interface StreamDone {
  _done: true
  total: number
}

interface StreamError {
  _error: string
}

type StreamLine = PcapEntry | StreamDone | StreamError

const isDone = (line: StreamLine): line is StreamDone => '_done' in line
const isError = (line: StreamLine): line is StreamError => '_error' in line

export async function* parsePcapStream(
  file: File,
  signal?: AbortSignal,
): AsyncGenerator<PcapEntry | StreamDone> {
  for await (const line of streamUploadNDJSON<StreamLine>(
    '/api/pcap/parse/stream',
    [file],
    signal,
  )) {
    if (isError(line)) {
      throw new Error(line._error)
    }
    yield line as PcapEntry | StreamDone
    if (isDone(line)) return
  }
}

export async function filterPcap(entries: PcapEntry[], filters: PcapFilters): Promise<PcapEntry[]> {
  const response = await fetch('/api/pcap/filter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries, filters }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to filter PCAP: ${text}`)
  }

  return response.json()
}

export async function getPcapStatistics(entries: PcapEntry[]): Promise<PcapStatistics> {
  const response = await fetch('/api/pcap/statistics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to get PCAP statistics: ${text}`)
  }

  return response.json()
}
