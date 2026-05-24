import { useState, useCallback, useRef } from 'react'
import type { PcapEntry } from '../types/pcap'

export interface ParseProgress {
  current: number
  total: number
}

interface UsePcapStreamReturn {
  allEntries: PcapEntry[]
  loading: boolean
  error: string | undefined
  fileNames: string[]
  formatDetected: string | undefined
  parsedCount: number
  parseProgress: ParseProgress | null
  loadPcapFile: (file: File) => Promise<boolean>
  abort: () => void
  reset: () => void
}

const BATCH_SIZE = 500

export function usePcapStream(): UsePcapStreamReturn {
  const [allEntries, setAllEntries] = useState<PcapEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fileNames, setFileNames] = useState<string[]>([])
  const [formatDetected, setFormatDetected] = useState<string | undefined>()
  const [parsedCount, setParsedCount] = useState(0)
  const [totalExpected, setTotalExpected] = useState<number>(0)
  const abortRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const reset = useCallback(() => {
    abort()
    setAllEntries([])
    setError(undefined)
    setFileNames([])
    setFormatDetected(undefined)
    setParsedCount(0)
    setTotalExpected(0)
  }, [abort])

  const loadPcapFile = useCallback(async (file: File): Promise<boolean> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(undefined)
    setFileNames([file.name])
    setAllEntries([])
    setFormatDetected(undefined)
    setParsedCount(0)
    setTotalExpected(0)

    const buffer: PcapEntry[] = []
    let count = 0
    let streamError: string | undefined

    const flush = () => {
      if (buffer.length === 0) return
      const toAdd = buffer.splice(0)
      setAllEntries((prev) => [...prev, ...toAdd])
    }

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/pcap/parse/stream', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let partialLine = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = (partialLine + chunk).split('\n')
        partialLine = lines.pop() || ''

        for (const line of lines) {
          if (!line.trim()) continue

          try {
            const obj = JSON.parse(line)

            if ('_done' in obj) {
              if ('total' in obj && typeof obj.total === 'number') {
                setTotalExpected(obj.total)
              }
              break
            }

            if ('_error' in obj) {
              streamError = obj._error
              setError(streamError)
              break
            }

            const entry = obj as PcapEntry
            buffer.push(entry)
            count++

            // Detect format from first entry
            if (count === 1 && entry.source_file) {
              const ext = entry.source_file.toLowerCase()
              if (ext.endsWith('.pcapng')) {
                setFormatDetected('pcapng')
              } else {
                setFormatDetected('pcap')
              }
            }

            if (buffer.length >= BATCH_SIZE) flush()

            // Update parsed count periodically (every 100 entries) for progress display
            if (count % 100 === 0) setParsedCount(count)
          } catch (parseErr) {
            console.error('Failed to parse NDJSON line:', line, parseErr)
          }
        }
      }

      flush()
      setParsedCount(count)
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') return false
      const msg = err instanceof Error ? err.message : 'Parse error'
      streamError = msg
      setError(msg)
    } finally {
      setLoading(false)
    }

    return streamError === undefined
  }, [])

  const parseProgress: ParseProgress | null =
    parsedCount > 0 && totalExpected > 0 ? { current: parsedCount, total: totalExpected } : null

  return {
    allEntries,
    loading,
    error,
    fileNames,
    formatDetected,
    parsedCount,
    parseProgress,
    loadPcapFile,
    abort,
    reset,
  }
}
