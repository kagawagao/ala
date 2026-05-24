import { useState, useCallback, useRef } from 'react'
import type { LogEntry, LogFilters, LogStatistics } from '../types'
import { streamFilteredLogs } from '../api/logs'
import type { FilterStreamDone } from '../api/logs'

export interface FilterProgress {
  matched: number
  scanned: number
  total?: number
}

interface UseLazyLogStreamReturn {
  displayLogs: LogEntry[]
  loading: boolean
  error: string | undefined
  fileNames: string[]
  formatDetected: string | undefined
  filterProgress: FilterProgress | null
  sourceRef: string | null
  stats: LogStatistics | null
  totalLines: number | undefined
  loadSource: (ref: string, labels: string[], lineCount?: number) => void
  triggerFilter: (filters: LogFilters) => Promise<void>
  abort: () => void
  reset: () => void
}

const BATCH_SIZE = 500

export function useLazyLogStream(): UseLazyLogStreamReturn {
  const [displayLogs, setDisplayLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fileNames, setFileNames] = useState<string[]>([])
  const [formatDetected, setFormatDetected] = useState<string | undefined>()
  const [filterProgress, setFilterProgress] = useState<FilterProgress | null>(null)
  const [sourceRef, setSourceRef] = useState<string | null>(null)
  const [stats, setStats] = useState<LogStatistics | null>(null)
  const [totalLines, setTotalLines] = useState<number | undefined>()

  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const reset = useCallback(() => {
    abort()
    setDisplayLogs([])
    setError(undefined)
    setFileNames([])
    setFormatDetected(undefined)
    setFilterProgress(null)
    setSourceRef(null)
    setStats(null)
    setTotalLines(undefined)
    setLoading(false)
  }, [abort])

  const loadSource = useCallback(
    (ref: string, labels: string[], lineCount?: number) => {
      abort()
      setSourceRef(ref)
      setFileNames(labels)
      setDisplayLogs([])
      setStats(null)
      setFilterProgress(null)
      setError(undefined)
      setFormatDetected(undefined)
      setLoading(false)
      if (lineCount !== undefined) {
        setTotalLines(lineCount)
      } else {
        setTotalLines(undefined)
      }
    },
    [abort],
  )

  const triggerFilter = useCallback(
    async (filters: LogFilters) => {
      if (!sourceRef) {
        setError('No source file loaded')
        return
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      const gen = ++generationRef.current

      setLoading(true)
      setError(undefined)
      setDisplayLogs([])
      setStats(null)
      setFilterProgress({ matched: 0, scanned: 0, total: totalLines })

      const buffer: LogEntry[] = []
      let matchedCount = 0
      let scannedCount = 0

      const flush = () => {
        if (buffer.length === 0) return
        const toAdd = buffer.splice(0)
        if (generationRef.current === gen) {
          setDisplayLogs((prev) => [...prev, ...toAdd])
        }
      }

      try {
        const generator = streamFilteredLogs(sourceRef, filters, controller.signal)
        for await (const line of generator) {
          if (controller.signal.aborted) break

          if ('_done' in line && line._done) {
            const done = line as FilterStreamDone
            matchedCount = done.matched
            scannedCount = done.scanned
            if (done.stats && generationRef.current === gen) {
              setStats(done.stats)
            }
            break
          }

          const entry = line as LogEntry
          buffer.push(entry)
          matchedCount++

          if (buffer.length >= BATCH_SIZE) flush()
        }
        flush()

        if (generationRef.current === gen) {
          setFilterProgress({
            matched: matchedCount,
            scanned: scannedCount,
            total: totalLines,
          })
        }
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        if (generationRef.current === gen) {
          const msg = err instanceof Error ? err.message : 'Filter stream error'
          setError(msg)
        }
      } finally {
        if (generationRef.current === gen) {
          setLoading(false)
        }
      }

      return
    },
    [sourceRef, totalLines],
  )

  return {
    displayLogs,
    loading,
    error,
    fileNames,
    formatDetected,
    filterProgress,
    sourceRef,
    stats,
    totalLines,
    loadSource,
    triggerFilter,
    abort,
    reset,
  }
}
