import { useState, useCallback, useRef } from 'react'
import type { LogEntry } from '../types'

type StreamFactory = (
  signal: AbortSignal,
) => AsyncGenerator<LogEntry | { _done?: boolean; _error?: string }, void, unknown>

interface UseLogStreamReturn {
  allLogs: LogEntry[]
  loading: boolean
  error: string | undefined
  fileNames: string[]
  formatDetected: string | undefined
  parsedCount: number
  loadFromStream: (streamFactory: StreamFactory, fileLabels: string[]) => Promise<void>
  abort: () => void
  reset: () => void
}

const BATCH_SIZE = 500

export function useLogStream(): UseLogStreamReturn {
  const [allLogs, setAllLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fileNames, setFileNames] = useState<string[]>([])
  const [formatDetected, setFormatDetected] = useState<string | undefined>()
  const [parsedCount, setParsedCount] = useState(0)
  const abortRef = useRef<AbortController | null>(null)
  const formatRef = useRef<string | undefined>()

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    abort()
    setAllLogs([])
    setError(undefined)
    setFileNames([])
    setFormatDetected(undefined)
    setParsedCount(0)
  }, [abort])

  const loadFromStream = useCallback(async (streamFactory: StreamFactory, fileLabels: string[]) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(undefined)
    setFileNames(fileLabels)
    setAllLogs([])
    setFormatDetected(undefined)
    setParsedCount(0)
    formatRef.current = undefined

    const buffer: LogEntry[] = []
    let count = 0

    const flush = () => {
      if (buffer.length === 0) return
      const toAdd = buffer.splice(0)
      setAllLogs((prev) => [...prev, ...toAdd])
    }

    try {
      const streamGen = streamFactory(controller.signal)
      for await (const line of streamGen) {
        if ('_done' in line) break
        if ('_error' in line) {
          setError(line._error as string)
          break
        }
        const entry = line as LogEntry
        buffer.push(entry)
        count++
        if (entry.source_file && !formatRef.current) {
          formatRef.current = entry.source_file
          setFormatDetected(entry.source_file)
        }
        if (buffer.length >= BATCH_SIZE) flush()
        // Update parsed count periodically (every 100 entries) for progress display
        if (count % 100 === 0) setParsedCount(count)
      }
      flush()
      setParsedCount(count)
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Parse error'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    allLogs,
    loading,
    error,
    fileNames,
    formatDetected,
    parsedCount,
    loadFromStream,
    abort,
    reset,
  }
}
