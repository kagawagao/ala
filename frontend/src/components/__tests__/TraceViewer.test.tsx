import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import TraceViewer from '../TraceViewer'
import type { TraceParseResult } from '../../types'

vi.mock('../../api/trace', () => ({
  filterTrace: vi.fn().mockResolvedValue({
    summary: {
      duration_ms: 100,
      process_count: 2,
      thread_count: 4,
      event_count: 50,
      processes: [{ pid: 100, name: 'system', thread_count: 2 }],
      top_slices: [{ name: 'draw', count: 5, duration_ms: 50 }],
      ftrace_events: ['sched_switch'],
      metadata: { key: 'value' },
    },
    format: 'proto',
    file_size: 2048,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        noFileLoaded: 'No file loaded',
        duration: 'Duration',
        processes: 'Processes',
        threads: 'Threads',
        events: 'Events',
        topSlices: 'Top Slices',
        ftraceEvents: 'FTrace Events',
        metadata: 'Metadata',
        process: 'Process',
        message: 'Message',
        filtered: 'Filtered',
        processFilter: 'Process Filter',
        resetFilter: 'Reset Filter',
        selectProcesses: 'Select processes…',
        processNameRegex: 'Name regex',
        pidCommaList: 'PIDs',
        applyFilter: 'Apply Filter',
        ms: 'ms',
      }
      return map[key] ?? key
    },
    i18n: { language: 'en' },
  }),
}))

function makeTraceResult(overrides: Partial<TraceParseResult> = {}): TraceParseResult {
  return {
    summary: {
      duration_ms: overrides.summary?.duration_ms ?? 1500.5,
      process_count: overrides.summary?.process_count ?? 5,
      thread_count: overrides.summary?.thread_count ?? 20,
      event_count: overrides.summary?.event_count ?? 500,
      processes: overrides.summary?.processes ?? [
        { pid: 1, name: 'system_server', thread_count: 10 },
        { pid: 2, name: 'com.android.app', thread_count: 5 },
        { pid: 3, name: 'surfaceflinger', thread_count: 3 },
      ],
      top_slices: overrides.summary?.top_slices ?? [
        { name: 'doFrame', count: 100, duration_ms: 800 },
        { name: 'measure', count: 50, duration_ms: 200 },
      ],
      ftrace_events: overrides.summary?.ftrace_events ?? ['sched_switch', 'sched_wakeup'],
      metadata: overrides.summary?.metadata ?? { 'trace_type': 'systrace', 'android_version': '14' },
    },
    format: overrides.format ?? 'proto',
    file_size: overrides.file_size ?? 102400,
  }
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <App>{children}</App>
}

describe('TraceViewer', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders empty state when traceResult is null', () => {
    render(
      <Wrapper>
        <TraceViewer traceResult={null} />
      </Wrapper>,
    )
    expect(screen.getByText('No file loaded')).toBeInTheDocument()
  })

  it('renders duration statistic', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Duration')).toBeInTheDocument()
  })

  it('renders process count statistic', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Processes')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders thread count statistic', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Threads')).toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
  })

  it('renders event count statistic', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Events')).toBeInTheDocument()
    expect(screen.getByText('500')).toBeInTheDocument()
  })

  it('shows format tag', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Format: proto')).toBeInTheDocument()
  })

  it('shows file size tag in KB', () => {
    const result = makeTraceResult({ file_size: 2048 })
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Size: 2.0 KB')).toBeInTheDocument()
  })

  it('renders process list table', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('system_server')).toBeInTheDocument()
    expect(screen.getByText('com.android.app')).toBeInTheDocument()
    expect(screen.getByText('surfaceflinger')).toBeInTheDocument()
  })

  it('renders top slices table', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Top Slices')).toBeInTheDocument()
    expect(screen.getByText('doFrame')).toBeInTheDocument()
    expect(screen.getByText('measure')).toBeInTheDocument()
  })

  it('renders FTrace events', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('FTrace Events')).toBeInTheDocument()
    expect(screen.getByText('sched_switch')).toBeInTheDocument()
    expect(screen.getByText('sched_wakeup')).toBeInTheDocument()
  })

  it('renders metadata', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Metadata')).toBeInTheDocument()
  })

  it('renders process filter UI', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Process Filter')).toBeInTheDocument()
    expect(screen.getByText('Apply Filter')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Select processes…')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Name regex')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('PIDs')).toBeInTheDocument()
  })

  it('shows reset filter button after filtering', async () => {
    const { filterTrace } = await import('../../api/trace')
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    // Type something in the PID field and click Apply
    const pidInput = screen.getByPlaceholderText('PIDs')
    await userEvent.type(pidInput, '100')
    await userEvent.click(screen.getByText('Apply Filter'))
    await waitFor(() => {
      expect(filterTrace).toHaveBeenCalled()
    })
    expect(screen.getByText('Reset Filter')).toBeInTheDocument()
  })

  it('clears filtered result on reset', async () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    const pidInput = screen.getByPlaceholderText('PIDs')
    await userEvent.type(pidInput, '100')
    await userEvent.click(screen.getByText('Apply Filter'))
    await waitFor(() => {
      expect(screen.getByText('Reset Filter')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('Reset Filter'))
    // After reset, the filtered tag should be gone
    expect(screen.queryByText('Filtered')).not.toBeInTheDocument()
  })

  it('shows filtered tag when filter is applied', async () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    const pidInput = screen.getByPlaceholderText('PIDs')
    await userEvent.type(pidInput, '100')
    await userEvent.click(screen.getByText('Apply Filter'))
    await waitFor(() => {
      expect(screen.getByText('Filtered')).toBeInTheDocument()
    })
  })

  it('handles filter with process name', async () => {
    const { filterTrace } = await import('../../api/trace')
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    const nameInput = screen.getByPlaceholderText('Name regex')
    await userEvent.type(nameInput, 'system')
    await userEvent.click(screen.getByText('Apply Filter'))
    await waitFor(() => {
      expect(filterTrace).toHaveBeenCalledWith(
        expect.objectContaining({ process_name: 'system' }),
      )
    })
  })

  it('clears filter when both PID and process name are empty', async () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    // Apply filter first
    const pidInput = screen.getByPlaceholderText('PIDs')
    await userEvent.type(pidInput, '100')
    await userEvent.click(screen.getByText('Apply Filter'))
    // Now clear and apply again
    await userEvent.clear(pidInput)
    await userEvent.click(screen.getByText('Apply Filter'))
    await waitFor(() => {
      expect(screen.queryByText('Filtered')).not.toBeInTheDocument()
    })
  })

  it('hides process table when processes array is empty', () => {
    const result = makeTraceResult({
      summary: {
        duration_ms: 100,
        process_count: 0,
        thread_count: 0,
        event_count: 0,
        processes: [],
        top_slices: [],
        ftrace_events: [],
        metadata: {},
      },
    })
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.queryByText('system_server')).not.toBeInTheDocument()
  })

  it('hides top slices when empty', () => {
    const result = makeTraceResult({
      summary: {
        duration_ms: 100,
        process_count: 1,
        thread_count: 2,
        event_count: 10,
        processes: [{ pid: 1, name: 'test', thread_count: 2 }],
        top_slices: [],
        ftrace_events: [],
        metadata: {},
      },
    })
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.queryByText('Top Slices')).not.toBeInTheDocument()
  })

  it('handles null duration', () => {
    const result = makeTraceResult({
      summary: {
        duration_ms: null,
        process_count: 1,
        thread_count: 2,
        event_count: 10,
        processes: [],
        top_slices: [],
        ftrace_events: [],
        metadata: {},
      },
    })
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getByText('Duration')).toBeInTheDocument()
  })
})
