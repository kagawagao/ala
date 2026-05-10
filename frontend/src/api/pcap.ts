import type { PcapEntry, PcapFilters, PcapParseResult, PcapStatistics } from '../types/pcap'
import { apiUpload, streamNDJSON } from './client'

export async function parsePcap(file: File): Promise<PcapParseResult> {
  return apiUpload<PcapParseResult>('/api/pcap/parse', file)
}

export async function parsePcapStream(
  file: File,
  onEntry: (entry: PcapEntry) => void,
  onProgress?: (count: number) => void,
  signal?: AbortSignal,
): Promise<{ total: number }> {
  let count = 0

  await streamNDJSON<PcapEntry>(
    '/api/pcap/parse/stream',
    file,
    (entry) => {
      onEntry(entry)
      count++
      if (onProgress) {
        onProgress(count)
      }
    },
    signal,
  )

  return { total: count }
}

export async function filterPcap(
  entries: PcapEntry[],
  filters: PcapFilters,
): Promise<PcapEntry[]> {
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
