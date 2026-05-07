import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import ProjectManager from '../ProjectManager'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

vi.mock('../../api/projects', () => ({
  listProjects: vi.fn().mockResolvedValue([
    { id: '1', name: 'TestApp', paths: ['/path/to/app'], include_patterns: [], exclude_patterns: [], filter_presets: [], created_at: '2025-01-01' },
    { id: '2', name: 'AnotherApp', paths: ['/path/to/other'], include_patterns: [], exclude_patterns: [], filter_presets: [], created_at: '2025-02-01' },
  ]),
  createProject: vi.fn().mockResolvedValue({
    id: '3', name: 'NewProject', paths: ['/new/path'], include_patterns: [], exclude_patterns: [], filter_presets: [], created_at: '2025-03-01',
  }),
  deleteProject: vi.fn().mockResolvedValue(undefined),
  listContextDocs: vi.fn().mockResolvedValue([
    { path: 'src/MainActivity.java', content: '...', size: 2048 },
    { path: 'src/Utils.kt', content: '...', size: 1024 },
  ]),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        backToAnalysis: 'Back to Analysis',
        projectSettings: 'Project Settings',
        projectSettingsDescription: 'Configure source code projects',
        noProjects: 'No projects configured',
        projectName: 'Project Name',
        projectNameRequired: 'Please enter a project name',
        projectNamePlaceholder: 'e.g., MyAndroidApp',
        projectPathRequired: 'Please enter the project path',
        projectPathPlaceholder: '/path/to/android/project',
        addProject: 'Add Project',
        projectAdded: 'Project added successfully',
        projectPaths: 'Project Paths',
        addPath: 'Add Path',
        paths: 'path(s)',
        contextDocs: 'Context Docs',
        noContextDocs: 'No context docs found',
        loading: 'Loading...',
        deleteConfirm: 'Are you sure you want to delete this?',
        cancel: 'Cancel',
      }
      return map[key] ?? key
    },
    i18n: { language: 'en' },
  }),
}))

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <App>{children}</App>
    </MemoryRouter>
  )
}

describe('ProjectManager', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders page title and description', async () => {
    const { listProjects } = await import('../../api/projects')
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(listProjects).toHaveBeenCalled()
    })
    expect(screen.getByText('Project Settings')).toBeInTheDocument()
    expect(screen.getByText('Configure source code projects')).toBeInTheDocument()
  })

  it('renders project list after loading', async () => {
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('TestApp')).toBeInTheDocument()
      expect(screen.getByText('AnotherApp')).toBeInTheDocument()
    })
  })

  it('shows project paths', async () => {
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('/path/to/app')).toBeInTheDocument()
    })
  })

  it('shows path count tag', async () => {
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('1 path(s)')).toBeInTheDocument()
    })
  })

  it('navigates back to / on back button click', async () => {
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('TestApp')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('Back to Analysis'))
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('opens add project form when Add Project is clicked', async () => {
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('TestApp')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('Add Project'))
    expect(screen.getByPlaceholderText('e.g., MyAndroidApp')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('/path/to/android/project')).toBeInTheDocument()
  })

  it('creates a project on form submit', async () => {
    const { createProject } = await import('../../api/projects')
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('TestApp')).toBeInTheDocument()
    })
    // Click Add Project
    await userEvent.click(screen.getByText('Add Project'))
    // Fill form
    await userEvent.type(screen.getByPlaceholderText('e.g., MyAndroidApp'), 'NewProject')
    await userEvent.type(screen.getByPlaceholderText('/path/to/android/project'), '/new/path')
    // Submit
    await userEvent.click(screen.getAllByText('Add Project')[1])
    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'NewProject', paths: ['/new/path'] }),
      )
    })
  })

  it('deletes a project on confirm', async () => {
    const { deleteProject } = await import('../../api/projects')
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('TestApp')).toBeInTheDocument()
    })
    // Click the delete button on the first project
    const deleteBtns = screen.getAllByLabelText('delete')
    await userEvent.click(deleteBtns[0])
    // Confirm the popconfirm
    // The popconfirm renders cancel + ok buttons
    const okBtn = document.querySelector('.ant-popconfirm .ant-btn-primary')
    if (okBtn) await userEvent.click(okBtn as HTMLElement)
    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalled()
    })
  })

  it('shows empty state when no projects', async () => {
    const { listProjects } = await import('../../api/projects')
    vi.mocked(listProjects).mockResolvedValueOnce([])
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('No projects configured')).toBeInTheDocument()
    })
  })

  it('loads context docs on collapse expand', async () => {
    const { listContextDocs } = await import('../../api/projects')
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('TestApp')).toBeInTheDocument()
    })
    // Expand the collapse by clicking the context docs label
    await userEvent.click(screen.getByText('Context Docs'))
    await waitFor(() => {
      expect(listContextDocs).toHaveBeenCalledWith('1')
    })
    // Context docs should appear after loading
    await waitFor(() => {
      expect(screen.getByText('src/MainActivity.java')).toBeInTheDocument()
    })
  })

  it('cancels add project form', async () => {
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('TestApp')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('Add Project'))
    await userEvent.click(screen.getByText('Cancel'))
    // Form should be hidden again
    expect(screen.queryByPlaceholderText('e.g., MyAndroidApp')).not.toBeInTheDocument()
  })

  it('shows error when project name is empty', async () => {
    render(
      <Wrapper>
        <ProjectManager />
      </Wrapper>,
    )
    await waitFor(() => {
      expect(screen.getByText('TestApp')).toBeInTheDocument()
    })
    await userEvent.click(screen.getByText('Add Project'))
    // Try to submit without filling form
    await userEvent.click(screen.getAllByText('Add Project')[1])
    // Should show validation error
    await waitFor(() => {
      expect(screen.getByText('Please enter a project name')).toBeInTheDocument()
    })
  })
})
