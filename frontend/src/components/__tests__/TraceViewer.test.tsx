import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { App } from 'antd'
import TraceViewer from '../TraceViewer'
import type { TraceParseResult } from '../../types'

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
      metadata: overrides.summary?.metadata ?? { trace_type: 'systrace', android_version: '14' },
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
    expect(screen.getAllByText('Processes').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('5').length).toBeGreaterThanOrEqual(1)
  })

  it('renders thread count statistic', () => {
    const result = makeTraceResult()
    render(
      <Wrapper>
        <TraceViewer traceResult={result} />
      </Wrapper>,
    )
    expect(screen.getAllByText('Threads').length).toBeGreaterThanOrEqual(1)
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
