import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DirectoryFilePicker from '../DirectoryFilePicker'
import type { DirectoryFileInfo } from '../../api/logs'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        directoryFilePicker: 'Select Log Files',
        selectedCount: `{{count}} selected`,
        cancel: 'Cancel',
        loadSelected: 'Load Selected',
        selectAll: 'Select All',
        deselectAll: 'Deselect All',
        search: 'Search',
        noFilesFound: 'No log files found',
      }
      if (typeof translations[key] === 'string') {
        const value = translations[key]
        if (options?.count !== undefined) return value.replace('{{count}}', String(options.count))
        return value
      }
      return key
    },
    i18n: { language: 'en' },
  }),
}))

function makeFile(overrides: Partial<DirectoryFileInfo> = {}): DirectoryFileInfo {
  return {
    name: overrides.name ?? 'test.log',
    path: overrides.path ?? '/logs/test.log',
    size: overrides.size ?? 1024,
    is_log: overrides.is_log ?? true,
  }
}

const defaultOnConfirm = vi.fn()
const defaultOnCancel = vi.fn()

function renderPicker(
  overrides: Partial<{
    open: boolean
    files: DirectoryFileInfo[]
    dirPath: string
    onConfirm: (selected: string[]) => void
    onCancel: () => void
  }> = {},
) {
  return render(
    <DirectoryFilePicker
      open={overrides.open ?? true}
      files={overrides.files ?? [makeFile(), makeFile({ name: 'trace.pb', path: '/logs/trace.pb', size: 2048 })]}
      dirPath={overrides.dirPath ?? '/logs'}
      onConfirm={overrides.onConfirm ?? defaultOnConfirm}
      onCancel={overrides.onCancel ?? defaultOnCancel}
    />,
  )
}

describe('DirectoryFilePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders directory path', () => {
    renderPicker({ dirPath: '/var/logs/android' })
    expect(screen.getByText('/var/logs/android')).toBeInTheDocument()
  })

  it('renders file names', () => {
    const files = [
      makeFile({ name: 'main.log', path: '/logs/main.log' }),
      makeFile({ name: 'system.log', path: '/logs/system.log' }),
    ]
    renderPicker({ files })
    expect(screen.getByText('main.log')).toBeInTheDocument()
    expect(screen.getByText('system.log')).toBeInTheDocument()
  })

  it('displays file sizes with formatting', () => {
    const files = [
      makeFile({ name: 'small.log', path: '/logs/small.log', size: 500 }),
      makeFile({ name: 'big.log', path: '/logs/big.log', size: 2_000_000 }),
    ]
    renderPicker({ files })
    expect(screen.getByText('500 B')).toBeInTheDocument()
    expect(screen.getByText('2.0 MB')).toBeInTheDocument()
  })

  it('shows gzip tag for .gz files', () => {
    const files = [makeFile({ name: 'logs.gz', path: '/logs/logs.gz' })]
    renderPicker({ files })
    expect(screen.getByText('gzip')).toBeInTheDocument()
  })

  it('shows zip tag for .zip files', () => {
    const files = [makeFile({ name: 'archive.zip', path: '/logs/archive.zip' })]
    renderPicker({ files })
    expect(screen.getByText('zip')).toBeInTheDocument()
  })

  it('has disabled confirm button when no files selected', async () => {
    renderPicker()
    // All files start selected, so deselect all
    await userEvent.click(screen.getByText('Deselect All'))
    const confirmBtn = screen.getByText('Load Selected')
    expect(confirmBtn).toBeDisabled()
  })

  it('calls onConfirm with selected paths', async () => {
    const onConfirm = vi.fn()
    const files = [
      makeFile({ name: 'a.log', path: '/logs/a.log' }),
      makeFile({ name: 'b.log', path: '/logs/b.log' }),
    ]
    renderPicker({ files, onConfirm })
    await userEvent.click(screen.getByText('Load Selected'))
    expect(onConfirm).toHaveBeenCalledWith(['/logs/a.log', '/logs/b.log'])
  })

  it('calls onCancel when cancel is clicked', async () => {
    const onCancel = vi.fn()
    renderPicker({ onCancel })
    await userEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalled()
  })

  it('filters files by search input', async () => {
    const files = [
      makeFile({ name: 'main.log', path: '/logs/main.log' }),
      makeFile({ name: 'system.log', path: '/logs/system.log' }),
      makeFile({ name: 'trace.pb', path: '/logs/trace.pb' }),
    ]
    renderPicker({ files })
    const searchInput = screen.getByPlaceholderText('Search')
    await userEvent.type(searchInput, 'system')
    expect(screen.getByText('system.log')).toBeInTheDocument()
    expect(screen.queryByText('main.log')).not.toBeInTheDocument()
    expect(screen.queryByText('trace.pb')).not.toBeInTheDocument()
  })

  it('shows empty state when search has no matches', async () => {
    const files = [makeFile({ name: 'main.log', path: '/logs/main.log' })]
    renderPicker({ files })
    const searchInput = screen.getByPlaceholderText('Search')
    await userEvent.type(searchInput, 'nonexistent')
    expect(screen.getByText('No log files found')).toBeInTheDocument()
  })

  it('toggles individual file selection', async () => {
    const onConfirm = vi.fn()
    const files = [
      makeFile({ name: 'a.log', path: '/logs/a.log' }),
      makeFile({ name: 'b.log', path: '/logs/b.log' }),
    ]
    renderPicker({ files, onConfirm })
    // Click the checkbox for the second file to deselect it
    const checkboxes = screen.getAllByRole('checkbox')
    // checkboxes[0] is "Select All", [1] is first file, [2] is second file
    await userEvent.click(checkboxes[2])
    await userEvent.click(screen.getByText('Load Selected'))
    expect(onConfirm).toHaveBeenCalledWith(['/logs/a.log'])
  })

  it('shows selected count in footer', () => {
    const files = [
      makeFile({ name: 'a.log', path: '/logs/a.log' }),
      makeFile({ name: 'b.log', path: '/logs/b.log' }),
    ]
    renderPicker({ files })
    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('groupes files by directory', () => {
    const files = [
      makeFile({ name: 'root.log', path: 'root.log' }),
      makeFile({ name: 'nested.log', path: 'subdir/nested.log' }),
    ]
    renderPicker({ files })
    expect(screen.getByText('root.log')).toBeInTheDocument()
    expect(screen.getByText('nested.log')).toBeInTheDocument()
    // Subdirectory label should be visible
    expect(screen.getByText(/subdir\//)).toBeInTheDocument()
  })

  it('renders closed when open=false', () => {
    renderPicker({ open: false })
    expect(screen.queryByText('Select Log Files')).toBeNull()
  })
})
