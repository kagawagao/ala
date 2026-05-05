import type { LogEntry } from '../types'

// ── CSV Export ─────────────────────────────────────────────────────────────

const CSV_COLUMNS: (keyof LogEntry)[] = [
  'line_number',
  'timestamp',
  'level',
  'tag',
  'pid',
  'tid',
  'message',
]

/**
 * Escape a CSV field per RFC 4180:
 * - If the value contains comma, double-quote, or newline, wrap in double quotes
 *   and escape internal double-quotes by doubling them.
 */
function csvEscape(value: unknown): string {
  const s = value == null ? '' : String(value)
  if (
    s.indexOf(',') !== -1 ||
    s.indexOf('"') !== -1 ||
    s.indexOf('\n') !== -1 ||
    s.indexOf('\r') !== -1
  ) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function generateCSV(logs: LogEntry[]): string {
  const header = CSV_COLUMNS.join(',')
  const rows = logs.map((log) => CSV_COLUMNS.map((col) => csvEscape(log[col])).join(','))
  // BOM prefix for Excel UTF-8 compatibility
  return '\uFEFF' + [header, ...rows].join('\n') + '\n'
}

// ── JSON Export ────────────────────────────────────────────────────────────

export function generateJSON(logs: LogEntry[]): string {
  return JSON.stringify(logs, null, 2)
}

// ── Download Helper ────────────────────────────────────────────────────────

export function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Release after a tick to ensure the download starts
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

export function generateExportFilename(format: 'csv' | 'json'): string {
  const date = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  return `ala-export-${date}.${format}`
}
