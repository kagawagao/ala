import { useState, useCallback, useRef } from 'react'
import type { LogEntry, LogFilters, LogStatistics } from '../types'
import { parseDirectoryStream, parseSelectedFilesStream, streamFilteredLogs } from '../api/logs'
import type { FilterStreamDone, StreamDone } from '../api/logs'

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
  isDirectory: boolean
  stats: LogStatistics | null
  totalLines: number | undefined
  loadSource: (ref: string, labels: string[], lineCount?: number, isDirectory?: boolean) => void
  loadDirectory: (dirPath: string, selectedFiles?: string[]) => Promise<void>
  triggerFilter: (filters: LogFilters) => Promise<void>
  abort: () => void
  reset: () => void
}

const BATCH_SIZE = 500

/** Client-side filtering for directory-loaded log entries. */
function filterLogEntriesLocal(entries: LogEntry[], filters: LogFilters): LogEntry[] {
  return entries.filter((entry) => {
    if (filters.level && entry.level !== filters.level) return false
    if (filters.pid && entry.pid !== filters.pid) return false
    if (filters.tid && entry.tid !== filters.tid) return false
    if (filters.start_time && entry.timestamp && entry.timestamp < filters.start_time) return false
    if (filters.end_time && entry.timestamp && entry.timestamp > filters.end_time) return false

    // Tag matching (OR between comma-separated tags)
    let tagMatch = true
    if (filters.tag) {
      const tags = filters.tag
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (tags.length > 0) {
        tagMatch = tags.some((t) => entry.tag.toLowerCase().includes(t.toLowerCase()))
      }
    }

    // Keyword matching (AND between comma-separated keywords)
    let keywordMatch = true
    if (filters.keywords) {
      const kws = filters.keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
      if (kws.length > 0) {
        const message = entry.message.toLowerCase()
        keywordMatch = kws.every((k) => message.includes(k.toLowerCase()))
      }
    }

    // Combine tag and keyword filters according to relation
    if (filters.tag && filters.keywords) {
      const relation = filters.tag_keyword_relation || 'AND'
      if (relation === 'OR') {
        return tagMatch || keywordMatch
      }
      return tagMatch && keywordMatch
    }
    // Only one of tag/keyword is set, or neither
    return tagMatch && keywordMatch
  })
}

export function useLazyLogStream(): UseLazyLogStreamReturn {
  const [displayLogs, setDisplayLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fileNames, setFileNames] = useState<string[]>([])
  const [formatDetected, setFormatDetected] = useState<string | undefined>()
  const [filterProgress, setFilterProgress] = useState<FilterProgress | null>(null)
  const [sourceRef, setSourceRef] = useState<string | null>(null)
  const [isDirectory, setIsDirectory] = useState(false)
  const [stats, setStats] = useState<LogStatistics | null>(null)
  const [totalLines, setTotalLines] = useState<number | undefined>()
  const [directoryEntries, setDirectoryEntries] = useState<LogEntry[]>([])

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
    setIsDirectory(false)
    setStats(null)
    setTotalLines(undefined)
    setDirectoryEntries([])
    setLoading(false)
  }, [abort])

  const loadSource = useCallback(
    (ref: string, labels: string[], lineCount?: number, isDir?: boolean) => {
      abort()
      setSourceRef(ref)
      setIsDirectory(isDir ?? false)
      setFileNames(labels)
      setDisplayLogs([])
      setStats(null)
      setFilterProgress(null)
      setError(undefined)
      setFormatDetected(isDir ? 'directory' : undefined)
      setLoading(false)
      if (lineCount !== undefined) {
        setTotalLines(lineCount)
      } else {
        setTotalLines(undefined)
      }
    },
    [abort],
  )

  const loadDirectory = useCallback(
    async (dirPath: string, selectedFiles?: string[]) => {
      abort()
      setSourceRef(dirPath)
      setIsDirectory(true)
      const label = dirPath.replace(/\\/g, '/').split('/').pop() || dirPath
      setFileNames(selectedFiles && selectedFiles.length > 0 ? selectedFiles : [label])
      setDisplayLogs([])
      setStats(null)
      setFilterProgress(null)
      setError(undefined)
      setFormatDetected('directory')
      setTotalLines(undefined)
      setLoading(true)

      const controller = new AbortController()
      abortRef.current = controller
      const gen = ++generationRef.current

      const allEntries: LogEntry[] = []

      try {
        const generator =
          selectedFiles && selectedFiles.length > 0
            ? parseSelectedFilesStream(dirPath, selectedFiles, controller.signal)
            : parseDirectoryStream(dirPath, controller.signal)
        for await (const line of generator) {
          if (controller.signal.aborted) break
          if ('_done' in line && line._done) {
            const done = line as StreamDone
            if (generationRef.current === gen) {
              setTotalLines(done.total)
            }
            break
          }
          allEntries.push(line as LogEntry)
        }

        if (generationRef.current === gen) {
          setDirectoryEntries(allEntries)
          setDisplayLogs(allEntries)
          setFilterProgress({
            matched: allEntries.length,
            scanned: allEntries.length,
            total: allEntries.length,
          })
        }
      } catch (err: unknown) {
        if ((err as Error).name === 'AbortError') return
        if (generationRef.current === gen) {
          const msg = err instanceof Error ? err.message : 'Directory parse error'
          setError(msg)
        }
      } finally {
        if (generationRef.current === gen) {
          setLoading(false)
        }
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

      // ── Directory mode: filter pre-loaded entries locally ────────
      if (isDirectory) {
        if (directoryEntries.length === 0) return // still loading, wait for next filter change
        setLoading(true)
        setError(undefined)
        setDisplayLogs([])
        setStats(null)
        setFilterProgress({ matched: 0, scanned: directoryEntries.length })

        try {
          const filtered = filterLogEntriesLocal(directoryEntries, filters)
          if (generationRef.current === gen) {
            setDisplayLogs(filtered)
            setFilterProgress({
              matched: filtered.length,
              scanned: directoryEntries.length,
              total: directoryEntries.length,
            })
          }
        } catch (err: unknown) {
          if ((err as Error).name === 'AbortError') return
          if (generationRef.current === gen) {
            setError(err instanceof Error ? err.message : 'Filter error')
          }
        } finally {
          if (generationRef.current === gen) {
            setLoading(false)
          }
        }
        return
      }

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
    [sourceRef, totalLines, isDirectory, directoryEntries],
  )

  return {
    displayLogs,
    loading,
    error,
    fileNames,
    formatDetected,
    filterProgress,
    sourceRef,
    isDirectory,
    stats,
    totalLines,
    loadSource,
    loadDirectory,
    triggerFilter,
    abort,
    reset,
  }
}
