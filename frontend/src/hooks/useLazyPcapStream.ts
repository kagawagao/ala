import { useState, useCallback, useRef } from 'react'
import type { PcapEntry, PcapFilters, PcapStatistics } from '../types/pcap'
import { streamFilteredPcap } from '../api/pcap'

export interface PcapFilterProgress {
  matched: number
  scanned: number
  total?: number
}

interface UseLazyPcapStreamReturn {
  displayEntries: PcapEntry[]
  loading: boolean
  error: string | undefined
  fileNames: string[]
  formatDetected: string | undefined
  filterProgress: PcapFilterProgress | null
  sourcePath: string | null
  stats: PcapStatistics | null
  /** Store a source path and file label — no parsing happens yet */
  loadSource: (path: string, labels: string[], format?: string) => void
  /** Trigger a backend stream-filter for the given filters */
  triggerFilter: (filters: PcapFilters) => Promise<void>
  abort: () => void
  reset: () => void
}

const BATCH_SIZE = 500

export function useLazyPcapStream(): UseLazyPcapStreamReturn {
  const [displayEntries, setDisplayEntries] = useState<PcapEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fileNames, setFileNames] = useState<string[]>([])
  const [formatDetected, setFormatDetected] = useState<string | undefined>()
  const [filterProgress, setFilterProgress] = useState<PcapFilterProgress | null>(null)
  const [sourcePath, setSourcePath] = useState<string | null>(null)
  const [stats, setStats] = useState<PcapStatistics | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const reset = useCallback(() => {
    abort()
    setDisplayEntries([])
    setError(undefined)
    setFileNames([])
    setFormatDetected(undefined)
    setFilterProgress(null)
    setSourcePath(null)
    setStats(null)
    setLoading(false)
  }, [abort])

  const loadSource = useCallback(
    (path: string, labels: string[], format?: string) => {
      abort()
      setSourcePath(path)
      setFileNames(labels)
      setDisplayEntries([])
      setStats(null)
      setFilterProgress(null)
      setError(undefined)
      setFormatDetected(format)
      setLoading(false)
    },
    [abort],
  )

  const triggerFilter = useCallback(
    async (filters: PcapFilters) => {
      if (!sourcePath) {
        setError('No PCAP source loaded')
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const gen = ++generationRef.current

      setLoading(true)
      setError(undefined)
      setDisplayEntries([])
      setStats(null)
      setFilterProgress({ matched: 0, scanned: 0 })

      const buffer: PcapEntry[] = []
      let matchedCount = 0
      let scannedCount = 0

      const flush = () => {
        if (buffer.length === 0) return
        const toAdd = buffer.splice(0)
        if (generationRef.current === gen) {
          setDisplayEntries((prev) => [...prev, ...toAdd])
        }
      }

      try {
        const generator = streamFilteredPcap(sourcePath, filters, controller.signal)
        for await (const line of generator) {
          if (controller.signal.aborted) break

          if ('_done' in line && line._done) {
            const done = line as {
              _done: true
              matched: number
              scanned: number
              stats: PcapStatistics
            }
            matchedCount = done.matched
            scannedCount = done.scanned
            if (done.stats && generationRef.current === gen) {
              setStats(done.stats)
            }
            break
          }

          const entry = line as PcapEntry
          buffer.push(entry)
          matchedCount++

          if (buffer.length >= BATCH_SIZE) flush()
        }
        flush()

        if (generationRef.current === gen) {
          setFilterProgress({
            matched: matchedCount,
            scanned: scannedCount,
          })
        }
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        if (generationRef.current === gen) {
          const msg = err instanceof Error ? err.message : 'PCAP filter stream error'
          setError(msg)
        }
      } finally {
        if (generationRef.current === gen) {
          setLoading(false)
        }
      }
    },
    [sourcePath],
  )

  return {
    displayEntries,
    loading,
    error,
    fileNames,
    formatDetected,
    filterProgress,
    sourcePath,
    stats,
    loadSource,
    triggerFilter,
    abort,
    reset,
  }
}
