import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import TraceFilterPanel from '../TraceFilterPanel'
import { filterTrace } from '../../api/trace'
import type { TraceParseResult } from '../../types'

vi.mock('../../api/trace', () => ({
  filterTrace: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        noFileLoaded: 'No file loaded',
        selectProcesses: 'Select processes…',
        processNameRegex: 'Name regex',
        pidCommaList: 'PIDs',
        applyFilter: 'Apply Filter',
        resetFilter: 'Reset Filter',
        traceFilterFailed: 'Filter failed',
      }
      return map[key] ?? key
    },
    i18n: { language: 'en' },
  }),
}))

function makeTraceResult(): TraceParseResult {
  return {
    summary: {
      duration_ms: 1500.5,
      process_count: 3,
      thread_count: 20,
      event_count: 500,
      processes: [
        { pid: 1, name: 'system_server', thread_count: 10 },
        { pid: 2, name: 'com.android.app', thread_count: 5 },
        { pid: 3, name: 'surfaceflinger', thread_count: 3 },
      ],
      top_slices: [{ name: 'doFrame', count: 100, duration_ms: 800 }],
      ftrace_events: ['sched_switch'],
      metadata: { trace_type: 'systrace' },
    },
    format: 'proto',
    file_size: 102400,
  }
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <App>{children}</App>
}

describe('TraceFilterPanel', () => {
  beforeEach(() => {
    vi.mocked(filterTrace).mockResolvedValue(makeTraceResult())
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the empty state when no trace is loaded', () => {
    render(
      <Wrapper>
        <TraceFilterPanel traceResult={null} onFilteredResult={vi.fn()} />
      </Wrapper>,
    )
    expect(screen.getByText('No file loaded')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /apply filter/i })).not.toBeInTheDocument()
  })

  it('renders the filter controls', () => {
    render(
      <Wrapper>
        <TraceFilterPanel traceResult={makeTraceResult()} onFilteredResult={vi.fn()} />
      </Wrapper>,
    )
    // antd v6 renders the Select placeholder as text content
    expect(screen.getByText('Select processes…')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Name regex')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('PIDs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /apply filter/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reset filter/i })).toBeInTheDocument()
  })

  it('applies a PID filter and reports the filtered result', async () => {
    const onFilteredResult = vi.fn()
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceFilterPanel traceResult={result} onFilteredResult={onFilteredResult} />
      </Wrapper>,
    )

    await userEvent.type(screen.getByPlaceholderText('PIDs'), '100, 200')
    await userEvent.click(screen.getByRole('button', { name: /apply filter/i }))

    await waitFor(() => {
      expect(filterTrace).toHaveBeenCalledWith({
        result,
        pids: [100, 200],
        process_name: undefined,
      })
    })
    await waitFor(() => {
      expect(onFilteredResult).toHaveBeenCalledWith(makeTraceResult())
    })
  })

  it('applies a process-name filter', async () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceFilterPanel traceResult={result} onFilteredResult={vi.fn()} />
      </Wrapper>,
    )

    await userEvent.type(screen.getByPlaceholderText('Name regex'), 'system')
    await userEvent.click(screen.getByRole('button', { name: /apply filter/i }))

    await waitFor(() => {
      expect(filterTrace).toHaveBeenCalledWith(expect.objectContaining({ process_name: 'system' }))
    })
  })

  it('ignores non-numeric PID input', async () => {
    const onFilteredResult = vi.fn()
    render(
      <Wrapper>
        <TraceFilterPanel traceResult={makeTraceResult()} onFilteredResult={onFilteredResult} />
      </Wrapper>,
    )

    await userEvent.type(screen.getByPlaceholderText('PIDs'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: /apply filter/i }))

    // No valid criteria → the panel clears the filtered view instead of calling the API
    await waitFor(() => {
      expect(onFilteredResult).toHaveBeenCalledWith(null)
    })
    expect(filterTrace).not.toHaveBeenCalled()
  })

  it('clears the filtered view when no criteria are provided', async () => {
    const onFilteredResult = vi.fn()
    render(
      <Wrapper>
        <TraceFilterPanel traceResult={makeTraceResult()} onFilteredResult={onFilteredResult} />
      </Wrapper>,
    )

    await userEvent.click(screen.getByRole('button', { name: /apply filter/i }))

    expect(onFilteredResult).toHaveBeenCalledWith(null)
    expect(filterTrace).not.toHaveBeenCalled()
  })

  it('resets inputs and clears the filtered view', async () => {
    const onFilteredResult = vi.fn()
    render(
      <Wrapper>
        <TraceFilterPanel traceResult={makeTraceResult()} onFilteredResult={onFilteredResult} />
      </Wrapper>,
    )

    const pidInput = screen.getByPlaceholderText('PIDs')
    await userEvent.type(pidInput, '100')
    await userEvent.click(screen.getByRole('button', { name: /reset filter/i }))

    expect(pidInput).toHaveValue('')
    expect(onFilteredResult).toHaveBeenCalledWith(null)
    expect(filterTrace).not.toHaveBeenCalled()
  })

  it('surfaces an error message when filtering fails', async () => {
    vi.mocked(filterTrace).mockRejectedValueOnce(new Error('boom'))
    render(
      <Wrapper>
        <TraceFilterPanel traceResult={makeTraceResult()} onFilteredResult={vi.fn()} />
      </Wrapper>,
    )

    await userEvent.type(screen.getByPlaceholderText('PIDs'), '100')
    await userEvent.click(screen.getByRole('button', { name: /apply filter/i }))

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })
  })
})
