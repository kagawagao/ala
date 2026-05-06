import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import AppSider from '../AppSider'
import type { LogFilters, LogStatistics, FilterPreset, HighlightItem } from '../../types'

vi.mock('../../api/projects', () => ({
  generateFilters: vi.fn(async function* () {
    yield JSON.stringify([
      { name: 'Errors', description: 'Filter errors', filters: { keywords: 'error', level: 'E' } },
    ])
    yield '[DONE]'
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        applyFilters: 'Apply Filters',
        clearFilters: 'Clear Filters',
        savePreset: 'Save Preset',
        exportFilters: 'Export Filters',
        importFilters: 'Import Filters',
        search: 'Search',
        startTime: 'Start Time',
        endTime: 'End Time',
        keywords: 'Keywords',
        keywordsPlaceholder: 'Filter by keywords (regex supported)',
        logLevel: 'Log Level',
        allLevels: 'All Levels',
        tag: 'Tag',
        tagPlaceholder: 'Filter by tag (regex)',
        pid: 'Process ID',
        pidPlaceholder: 'e.g., 1234',
        tid: 'Thread ID',
        tidPlaceholder: 'e.g., 5678',
        tagKeywordRelation: 'Tag/Keyword Relation',
        lineBreakMode: 'Line Break Mode',
        wordWrap: 'Word Wrap',
        noWrap: 'No Wrap',
        highlights: 'Highlights',
        highlightsPlaceholder: 'Highlight keywords (visual only)',
        filterPresets: 'Filter Presets',
        noPresets: 'No saved presets',
        apply: 'Apply',
        delete: 'Delete',
        deleteConfirm: 'Are you sure you want to delete this?',
        cancel: 'Cancel',
        statistics: 'Statistics',
        totalLogs: 'Total',
        verbose: 'Verbose',
        debug: 'Debug',
        info: 'Info',
        warning: 'Warning',
        error: 'Error',
        fatal: 'Fatal',
        filterDisabledNoConditions: 'Please enter at least one filter condition',
        initFilters: 'Initialize Filters',
        updateFilters: 'Update Filters',
        filtersGenerated: 'Filter presets generated successfully',
        filtersGenerateFailed: 'Failed to generate filters',
        presetName: 'Preset Name',
        presetDescription: 'Description (optional)',
        filterPresetManager: 'Filter Preset Manager',
        filtersPendingChanges: 'Pending changes',
        fileUploaded: 'File uploaded successfully',
        parseError: 'Failed to parse file',
      }
      return map[key] ?? key
    },
    i18n: { language: 'en' },
  }),
}))

function defaultFilters(overrides: Partial<LogFilters> = {}): LogFilters {
  return {
    start_time: '',
    end_time: '',
    keywords: '',
    level: '',
    tag: '',
    pid: '',
    tid: '',
    tag_keyword_relation: 'AND',
    ...overrides,
  }
}

function makeStatistics(): LogStatistics {
  return {
    total: 100,
    by_level: { I: 60, E: 30, W: 10 },
    tags: { TestTag: 50, CrashTag: 20, UIRender: 10 },
    pids: { '100': 50, '200': 30 },
  }
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return <App>{children}</App>
}

describe('AppSider', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders filter inputs', () => {
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    expect(screen.getByPlaceholderText('MM-DD HH:mm:ss.SSS')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Filter by keywords (regex supported)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Filter by tag (regex)')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g., 1234')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g., 5678')).toBeInTheDocument()
  })

  it('renders apply filters button', () => {
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    expect(screen.getByText('Apply Filters')).toBeInTheDocument()
  })

  it('clears filters when clear button is clicked', async () => {
    const onFiltersChange = vi.fn()
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={onFiltersChange}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    await userEvent.click(screen.getByLabelText('Clear Filters'))
    expect(onFiltersChange).toHaveBeenCalledWith({
      start_time: '',
      end_time: '',
      keywords: '',
      level: '',
      tag: '',
      pid: '',
      tid: '',
      tag_keyword_relation: 'AND',
    })
  })

  it('apply button is disabled when no filter conditions', () => {
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    const applyBtn = screen.getByText('Apply Filters').closest('button')
    expect(applyBtn).toBeDisabled()
  })

  it('apply button is enabled when a filter condition is set', async () => {
    const onFiltersChange = vi.fn()
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={onFiltersChange}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    // Type in keywords to enable
    const keywordInput = screen.getByPlaceholderText('Filter by keywords (regex supported)')
    await userEvent.type(keywordInput, 'error')
    const applyBtn = screen.getByText('Apply Filters').closest('button')
    expect(applyBtn).not.toBeDisabled()
  })

  it('calls onFiltersChange when apply is clicked', async () => {
    const onFiltersChange = vi.fn()
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={onFiltersChange}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    const keywordInput = screen.getByPlaceholderText('Filter by keywords (regex supported)')
    await userEvent.type(keywordInput, 'crash')
    await userEvent.click(screen.getByText('Apply Filters'))
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: 'crash' }),
    )
  })

  it('updates pending keyword filter without applying', async () => {
    const onFiltersChange = vi.fn()
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={onFiltersChange}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    const keywordInput = screen.getByPlaceholderText('Filter by keywords (regex supported)')
    await userEvent.type(keywordInput, 'test')
    // onFiltersChange should NOT have been called just by typing
    expect(onFiltersChange).not.toHaveBeenCalled()
  })

  it('adds a highlight', async () => {
    const onHighlightsChange = vi.fn()
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={onHighlightsChange}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    const highlightInput = screen.getByPlaceholderText('Highlight keywords (visual only)')
    await userEvent.type(highlightInput, 'error')
    await userEvent.click(highlightInput.nextElementSibling as HTMLElement)
    expect(onHighlightsChange).toHaveBeenCalledWith([{ pattern: 'error', color: '#fadb14' }])
  })

  it('removes a highlight', async () => {
    const onHighlightsChange = vi.fn()
    const highlights: HighlightItem[] = [
      { pattern: 'error', color: '#ff0000' },
      { pattern: 'warn', color: '#ffff00' },
    ]
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={highlights}
          onHighlightsChange={onHighlightsChange}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    // The highlights section is in a Collapse. Find delete buttons
    const deleteBtns = screen.getAllByLabelText('delete')
    await userEvent.click(deleteBtns[0])
    expect(onHighlightsChange).toHaveBeenCalledWith([{ pattern: 'warn', color: '#ffff00' }])
  })

  it('shows no presets when presets array is empty', () => {
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    expect(screen.getByText('No saved presets')).toBeInTheDocument()
  })

  it('saves a preset via modal', async () => {
    const onPresetsChange = vi.fn()
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters({ keywords: 'error' })}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={onPresetsChange}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    // Open save preset modal
    await userEvent.click(screen.getByLabelText('Save Preset'))
    // Fill in preset name
    const nameInput = screen.getByPlaceholderText('Preset Name')
    await userEvent.type(nameInput, 'My Preset')
    // Click OK
    await userEvent.click(screen.getByText('Save Preset'))
    expect(onPresetsChange).toHaveBeenCalled()
  })

  it('applies a preset when its apply button is clicked', async () => {
    const onFiltersChange = vi.fn()
    const presets: FilterPreset[] = [
      { id: '1', name: 'Error Filter', filters: defaultFilters({ keywords: 'error', level: 'E' }) },
    ]
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={onFiltersChange}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={presets}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    // Click apply on the preset
    await userEvent.click(screen.getByText('Apply'))
    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ keywords: 'error', level: 'E' }),
    )
  })

  it('deletes a preset', async () => {
    const onPresetsChange = vi.fn()
    const presets: FilterPreset[] = [
      { id: '1', name: 'Error Filter', filters: defaultFilters() },
    ]
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={presets}
          onPresetsChange={onPresetsChange}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    // Click delete on the preset
    const deleteBtn = screen.getAllByLabelText('delete')[0]
    await userEvent.click(deleteBtn)
    // Popconfirm appears; click the confirm delete button
    const confirmDelete = screen.getByText('Delete')
    await userEvent.click(confirmDelete)
    expect(onPresetsChange).toHaveBeenCalledWith([])
  })

  it('toggles word wrap', async () => {
    const onWordWrapChange = vi.fn()
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={onWordWrapChange}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    const wrapBtn = screen.getByText('Word Wrap')
    await userEvent.click(wrapBtn)
    expect(onWordWrapChange).toHaveBeenCalledWith(true)
  })

  it('shows statistics when provided', () => {
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={makeStatistics()}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    expect(screen.getByText('Statistics')).toBeInTheDocument()
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('does not show statistics when null', () => {
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    expect(screen.queryByText('Statistics')).not.toBeInTheDocument()
  })

  it('shows AI filter generation button when project is selected', () => {
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId="proj-1"
        />
      </Wrapper>,
    )
    expect(screen.getByText('Initialize Filters')).toBeInTheDocument()
  })

  it('does not show AI filter generation button when no project selected', () => {
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={vi.fn()}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId={null}
        />
      </Wrapper>,
    )
    expect(screen.queryByText('Initialize Filters')).not.toBeInTheDocument()
  })

  it('generates AI filters', async () => {
    const onPresetsChange = vi.fn()
    render(
      <Wrapper>
        <AppSider
          filters={defaultFilters()}
          onFiltersChange={vi.fn()}
          highlights={[]}
          onHighlightsChange={vi.fn()}
          statistics={null}
          presets={[]}
          onPresetsChange={onPresetsChange}
          wordWrap={false}
          onWordWrapChange={vi.fn()}
          selectedProjectId="proj-1"
        />
      </Wrapper>,
    )
    await userEvent.click(screen.getByText('Initialize Filters'))
    await waitFor(() => {
      expect(onPresetsChange).toHaveBeenCalled()
    })
  })
})
