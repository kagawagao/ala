import { apiFetch, apiUploadMulti, streamUploadNDJSON, streamNDJSON } from './client'
import type { LocalFileRef } from '../types'
import type { LogEntry, LogFilters, LogStatistics, ParseResult } from '../types'

/** Sentinel line emitted by the backend at the end of a stream. */
interface StreamDone {
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

/**
 * Parse one or more log files.
 *
 * Returns the flat list of ``ParseResult`` objects (one per extracted
 * text member, so a ZIP with three logs → three results).
 */
/** Register a local log file for lazy AI-driven analysis (FEAT-LAZY-LOG). */
export async function parseLocalPath(path: string, sandboxRoot?: string): Promise<LocalFileRef> {
  return apiFetch<LocalFileRef>('/logs/parse-local', {
    method: 'POST',
    body: JSON.stringify({ path, sandbox_root: sandboxRoot ?? null }),
  })
}

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
}

export interface DirectoryListResponse {
  files: DirectoryFileInfo[]
  has_subdirectories: boolean
  total_files: number
  max_depth: number
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
