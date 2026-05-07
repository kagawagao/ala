import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import LogViewer from '../LogViewer'
import type { LogEntry, HighlightItem } from '../../types'

vi.mock('../../utils/export', () => ({
  generateCSV: vi.fn(() => 'csv,content'),
  generateJSON: vi.fn(() => '{"json":"content"}'),
  downloadBlob: vi.fn(),
  generateExportFilename: vi.fn((format: string) => `export.${format}`),
}))

// We import the mocked module to access the spy
import { downloadBlob } from '../../utils/export'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        line: 'Line',
        timestamp: 'Timestamp',
        tag: 'Tag',
        message: 'Message',
        copy: 'Copy',
        copied: 'Copied!',
        noFileLoaded: 'No file loaded',
        filteredCount: '{{count}} / {{total}}',
        formatDetected: 'Format: {{format}}',
        exportCsv: 'CSV',
        exportJson: 'JSON',
        noDataToExport: 'No data to export',
        noLogsFound: 'No logs found',
      }
      const value = map[key] ?? key
      if (options) {
        return value.replace(/\{\{(.+?)\}\}/g, (_, k) =>
          String((options as Record<string, unknown>)[k] ?? ''),
        )
      }
      return value
    },
    i18n: { language: 'en' },
  }),
}))

// Mock clipboard
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
})

function makeLog(overrides: Partial<LogEntry> & { line_number: number }): LogEntry {
  return {
    line_number: overrides.line_number,
    timestamp: overrides.timestamp ?? '12:00:00.000',
    level: overrides.level ?? 'I',
    pid: overrides.pid ?? '100',
    tid: overrides.tid ?? '200',
    tag: overrides.tag ?? 'TestTag',
    message: overrides.message ?? `Log message ${overrides.line_number}`,
    raw_line: overrides.raw_line ?? `raw line ${overrides.line_number}`,
    source_file: overrides.source_file ?? null,
  }
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <App>{children}</App>
}

describe('LogViewer', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders empty state when no logs and totalLogs is 0', () => {
    render(
      <Wrapper>
        <LogViewer logs={[]} totalLogs={0} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('No file loaded')).toBeInTheDocument()
  })

  it('renders filtered count when logs exist', () => {
    const logs = [makeLog({ line_number: 1 }), makeLog({ line_number: 2 })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={10} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('2 / 10')).toBeInTheDocument()
  })

  it('renders table columns', () => {
    const logs = [makeLog({ line_number: 1 })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('Line')).toBeInTheDocument()
    expect(screen.getByText('Timestamp')).toBeInTheDocument()
    expect(screen.getByText('Tag')).toBeInTheDocument()
    expect(screen.getByText('Message')).toBeInTheDocument()
  })

  it('shows log level with color-coded tag for error level', () => {
    const logs = [makeLog({ line_number: 1, level: 'E' })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    // The level tag renders the level letter
    expect(screen.getByText('E')).toBeInTheDocument()
  })

  it('shows log level with color-coded tag for warning', () => {
    const logs = [makeLog({ line_number: 1, level: 'W' })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('W')).toBeInTheDocument()
  })

  it('shows log level with color-coded tag for fatal', () => {
    const logs = [makeLog({ line_number: 1, level: 'F' })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('F')).toBeInTheDocument()
  })

  it('shows no-logs-found when filtered to zero but totalLogs > 0', () => {
    render(
      <Wrapper>
        <LogViewer logs={[]} totalLogs={100} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('No logs found')).toBeInTheDocument()
  })

  it('shows formatDetected when provided', () => {
    const logs = [makeLog({ line_number: 1 })]
    render(
      <Wrapper>
        <LogViewer
          logs={logs}
          totalLogs={1}
          highlights={[]}
          wordWrap={false}
          formatDetected="logcat"
        />
      </Wrapper>,
    )
    expect(screen.getByText('Format: logcat')).toBeInTheDocument()
  })

  it('does not show formatDetected when not provided', () => {
    const logs = [makeLog({ line_number: 1 })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.queryByText('Format: logcat')).not.toBeInTheDocument()
  })

  it('renders both CSV and JSON export buttons', () => {
    const logs = [makeLog({ line_number: 1 })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('CSV')).toBeInTheDocument()
    expect(screen.getByText('JSON')).toBeInTheDocument()
  })

  it('export buttons are disabled when logs is empty', () => {
    render(
      <Wrapper>
        <LogViewer logs={[]} totalLogs={100} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    const csvBtn = screen.getByText('CSV').closest('button')
    const jsonBtn = screen.getByText('JSON').closest('button')
    expect(csvBtn).toBeDisabled()
    expect(jsonBtn).toBeDisabled()
  })

  it('calls downloadBlob when CSV export button is clicked', async () => {
    const logs = [makeLog({ line_number: 1 })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    await userEvent.click(screen.getByText('CSV'))
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'text/csv;charset=utf-8',
    )
  })

  it('calls downloadBlob when JSON export button is clicked', async () => {
    const logs = [makeLog({ line_number: 1 })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    await userEvent.click(screen.getByText('JSON'))
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      'application/json;charset=utf-8',
    )
  })

  it('renders PID and TID columns', () => {
    const logs = [makeLog({ line_number: 1, pid: '1234', tid: '5678' })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('1234')).toBeInTheDocument()
    expect(screen.getByText('5678')).toBeInTheDocument()
  })

  it('renders timestamp in table', () => {
    const logs = [makeLog({ line_number: 1, timestamp: '01-15 14:30:00.123' })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('01-15 14:30:00.123')).toBeInTheDocument()
  })

  it('renders message with wordWrap=false (nowrap style)', () => {
    const logs = [makeLog({ line_number: 1, message: 'a long message string' })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    expect(screen.getByText('a long message string')).toBeInTheDocument()
  })

  it('renders message with wordWrap=true (pre-wrap style)', () => {
    const logs = [makeLog({ line_number: 1, message: 'a wrapped message' })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={true} />
      </Wrapper>,
    )
    expect(screen.getByText('a wrapped message')).toBeInTheDocument()
  })

  it('calls clipboard.writeText when copy icon is clicked', async () => {
    const logs = [makeLog({ line_number: 1, raw_line: '01-15 14:30:00.000 I TestTag: hello' })]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={[]} wordWrap={false} />
      </Wrapper>,
    )
    // Find the copy button by its tooltip aria-label
    const copyBtn = screen.getByRole('button', { name: /copy/i })
    await userEvent.click(copyBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      '01-15 14:30:00.000 I TestTag: hello',
    )
  })

  it('highlights matched text in messages', () => {
    const logs = [makeLog({ line_number: 1, message: 'Error: something went wrong' })]
    const highlights: HighlightItem[] = [{ pattern: 'error', color: '#ff0000' }]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={highlights} wordWrap={false} />
      </Wrapper>,
    )
    // The highlighted text should be wrapped in a <mark> element
    const mark = document.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.style.background).toBe('rgb(255, 0, 0)')
  })

  it('does not highlight when no patterns match', () => {
    const logs = [makeLog({ line_number: 1, message: 'all good' })]
    const highlights: HighlightItem[] = [{ pattern: 'error', color: '#ff0000' }]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={highlights} wordWrap={false} />
      </Wrapper>,
    )
    expect(document.querySelector('mark')).toBeNull()
  })

  it('skips empty highlight patterns', () => {
    const logs = [makeLog({ line_number: 1, message: 'test' })]
    const highlights: HighlightItem[] = [{ pattern: '   ', color: '#ff0000' }]
    render(
      <Wrapper>
        <LogViewer logs={logs} totalLogs={1} highlights={highlights} wordWrap={false} />
      </Wrapper>,
    )
    expect(document.querySelector('mark')).toBeNull()
  })
})
