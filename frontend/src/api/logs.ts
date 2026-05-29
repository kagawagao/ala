import { apiFetch, apiUploadMulti, streamUploadNDJSON, streamNDJSON } from './client'
import type { LocalFileRef } from '../types'
import type { LogEntry, LogFilters, LogStatistics, ParseResult } from '../types'

/** Sentinel line emitted by the backend at the end of a stream. */
export interface StreamDone {
  _done: true
  total: number
}

interface StreamError {
  _error: string
}

type StreamLine = LogEntry | StreamDone | StreamError

function isDone(line: StreamLine): line is StreamDone {
  return '_done' in line
}

function isError(line: StreamLine): line is StreamError {
  return '_error' in line
}

/** Sentinel for POST /logs/filter/stream — includes stats. */
export interface FilterStreamDone {
  _done: true
  matched: number
  scanned: number
  stats: LogStatistics
}

/** Response for POST /logs/upload/temp. */
export interface TempFileInfo {
  original_name: string
  saved_path: string
  size_bytes: number
  format_detected: string
}

export interface TempUploadResponse {
  session_uuid: string
  files: TempFileInfo[]
}

/** Register a local log file for lazy AI-driven analysis (FEAT-LAZY-LOG). */
export async function parseLocalPath(path: string): Promise<LocalFileRef> {
  return apiFetch<LocalFileRef>('/logs/parse-local', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

/**
 * Parse one or more log files.
 *
 * Returns the flat list of ``ParseResult`` objects (one per extracted
 * text member, so a ZIP with three logs → three results).
 */
export async function parseLog(files: File | File[]): Promise<ParseResult[]> {
  const fileList = Array.isArray(files) ? files : [files]
  return apiUploadMulti<ParseResult[]>('/logs/parse', fileList)
}

/**
 * Stream-parse one or more log files.
 *
 * Calls ``POST /api/logs/parse/stream`` and yields ``LogEntry`` objects as
 * they arrive.  Also yields the final ``{_done, total}`` sentinel so callers
 * can show a completion message.
 */
export async function* parseLogStream(
  files: File | File[],
  signal?: AbortSignal,
): AsyncGenerator<LogEntry | StreamDone> {
  const fileList = Array.isArray(files) ? files : [files]
  for await (const line of streamUploadNDJSON<StreamLine>('/logs/parse/stream', fileList, signal)) {
    if (isError(line)) {
      throw new Error(line._error)
    }
    yield line as LogEntry | StreamDone
    if (isDone(line)) return
  }
}

export async function filterLogs(
  logs: LogEntry[],
  filters: Partial<LogFilters>,
): Promise<LogEntry[]> {
  return apiFetch<LogEntry[]>('/logs/filter', {
    method: 'POST',
    body: JSON.stringify({ logs, filters }),
  })
}

export async function getStatistics(logs: LogEntry[]): Promise<LogStatistics> {
  return apiFetch<LogStatistics>('/logs/statistics', {
    method: 'POST',
    body: JSON.stringify(logs),
  })
}

export interface DirectoryFileInfo {
  name: string
  path: string
  size: number
  is_log: boolean
  file_type: string // "log" | "hci" | "pcap" | "trace"
}

export interface DirectoryListResponse {
  files: DirectoryFileInfo[]
  has_subdirectories: boolean
  total_files: number
  max_depth: number
}

export interface AutoPathResponse {
  type: 'file' | 'directory'
  // File fields
  session_file?: string
  line_count?: number
  size_bytes?: number
  format_detected?: string
  is_gzip?: boolean
  is_zip?: boolean
  // Directory fields
  files?: DirectoryFileInfo[]
  has_subdirectories?: boolean
  total_files?: number
  max_depth?: number
}

/** Auto-detect path type — file or directory — and route accordingly. */
export async function autoPath(path: string): Promise<AutoPathResponse> {
  return apiFetch<AutoPathResponse>('/logs/auto-path', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

/**
 * List log files in a local directory on the server (recursive).
 */
export async function listDirectoryFiles(path: string): Promise<DirectoryListResponse> {
  return apiFetch<DirectoryListResponse>('/logs/directory/list', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

/**
 * Stream-parse all log files from a local directory.
 */
export async function* parseDirectoryStream(
  dirPath: string,
  signal?: AbortSignal,
): AsyncGenerator<LogEntry | StreamDone> {
  for await (const line of streamNDJSON<StreamLine>(
    '/logs/directory/parse/stream',
    { path: dirPath },
    signal,
  )) {
    if (isError(line)) {
      throw new Error(line._error)
    }
    yield line as LogEntry | StreamDone
    if (isDone(line)) return
  }
}

/**
 * Stream-parse a single local log file on the server.
 *
 * Calls ``POST /api/logs/file/parse/stream`` and yields ``LogEntry`` objects
 * as they arrive.  Also yields the final ``{_done, total}`` sentinel.
 */
export async function* parseLocalFileStream(
  filePath: string,
  signal?: AbortSignal,
): AsyncGenerator<LogEntry | StreamDone> {
  for await (const line of streamNDJSON<StreamLine>(
    '/logs/file/parse/stream',
    { path: filePath },
    signal,
  )) {
    if (isError(line)) {
      throw new Error(line._error)
    }
    yield line as LogEntry | StreamDone
    if (isDone(line)) return
  }
}

/**
 * Stream-parse only selected log files from a directory.
 */
export async function* parseSelectedFilesStream(
  dirPath: string,
  selectedFiles: string[],
  signal?: AbortSignal,
): AsyncGenerator<LogEntry | StreamDone> {
  for await (const line of streamNDJSON<StreamLine>(
    '/logs/directory/parse/selected/stream',
    { path: dirPath, selected_files: selectedFiles },
    signal,
  )) {
    if (isError(line)) {
      throw new Error(line._error)
    }
    yield line as LogEntry | StreamDone
    if (isDone(line)) return
  }
}

/**
 * Stream filtered log entries from a local file via the backend.
 *
 * Calls ``POST /api/logs/filter/stream`` and yields only matching
 * ``LogEntry`` objects.  The final sentinel ``{_done, matched, scanned, stats}``
 * is yielded at end of stream.
 */
export async function* streamFilteredLogs(
  filePath: string,
  filters: LogFilters,
  signal?: AbortSignal,
): AsyncGenerator<LogEntry | FilterStreamDone> {
  type FilterLine =
    | LogEntry
    | { _done: true; matched: number; scanned: number; stats: LogStatistics }
    | { _error: string }

  for await (const line of streamNDJSON<FilterLine>(
    '/logs/filter/stream',
    { path: filePath, filters },
    signal,
  )) {
    if ('_error' in line) {
      throw new Error(line._error)
    }
    yield line as LogEntry | FilterStreamDone
    if ('_done' in line) return
  }
}

/**
 * Upload log files to a temp directory on the server.
 *
 * Calls ``POST /api/logs/upload/temp`` and returns the session UUID
 * and saved file paths that can be used with ``streamFilteredLogs``.
 */
export async function uploadToTemp(files: File[]): Promise<TempUploadResponse> {
  return apiUploadMulti<TempUploadResponse>('/logs/upload/temp', files)
}
