import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Header from '../Header'
import type { Project } from '../../types'

const mockNavigate = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        showSidebar: 'Show sidebar',
        hideSidebar: 'Hide sidebar',
        connected: 'Connected',
        disconnected: 'Disconnected',
        selectProject: 'Select project',
        switchToLightMode: 'Switch to light',
        switchToDarkMode: 'Switch to dark',
        switchLanguage: 'Switch language',
        langCode: 'EN',
        projectSettings: 'Project Settings',
        modelManagement: 'Model Management',
      }
      return map[key] ?? key
    },
    i18n: { language: 'en' },
  }),
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? 'proj-1',
    name: overrides.name ?? 'Test Project',
    paths: overrides.paths ?? ['/path/to/project'],
    include_patterns: overrides.include_patterns ?? [],
    exclude_patterns: overrides.exclude_patterns ?? [],
    filter_presets: overrides.filter_presets ?? [],
    created_at: overrides.created_at ?? '2025-01-01',
  }
}

describe('Header', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders ALA brand text', () => {
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('ALA')).toBeInTheDocument()
  })

  it('shows connected tag when backendConnected is true', () => {
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('shows disconnected tag when backendConnected is false', () => {
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={false}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
  })

  it('calls onToggleTheme when theme button clicked', async () => {
    const onToggleTheme = vi.fn()
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={onToggleTheme}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    // MoonOutlined when isDark=false
    const themeBtn = screen.getByRole('button', { name: /switch to dark/i })
    await userEvent.click(themeBtn)
    expect(onToggleTheme).toHaveBeenCalled()
  })

  it('shows sun icon when dark mode is active', () => {
    render(
      <MemoryRouter>
        <Header
          isDark={true}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /switch to light/i })).toBeInTheDocument()
  })

  it('calls onToggleLanguage when language button clicked', async () => {
    const onToggleLanguage = vi.fn()
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={onToggleLanguage}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    const langBtn = screen.getByRole('button', { name: /switch language/i })
    await userEvent.click(langBtn)
    expect(onToggleLanguage).toHaveBeenCalled()
  })

  it('calls onToggleSider when sidebar button clicked', async () => {
    const onToggleSider = vi.fn()
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={onToggleSider}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    const siderBtn = screen.getByRole('button', { name: /hide sidebar/i })
    await userEvent.click(siderBtn)
    expect(onToggleSider).toHaveBeenCalled()
  })

  it('shows unfold icon when sidebar is collapsed', () => {
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={true}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: /show sidebar/i })).toBeInTheDocument()
  })

  it('renders project selector when projects exist', () => {
    const projects = [
      makeProject({ id: '1', name: 'My App' }),
      makeProject({ id: '2', name: 'Another' }),
    ]
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={projects}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Select project')).toBeInTheDocument()
  })

  it('navigates to /projects on project settings click', async () => {
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: /project settings/i })
    await userEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/projects')
  })

  it('navigates to /models on model management click', async () => {
    render(
      <MemoryRouter>
        <Header
          isDark={false}
          onToggleTheme={vi.fn()}
          language="en"
          onToggleLanguage={vi.fn()}
          siderCollapsed={false}
          onToggleSider={vi.fn()}
          backendConnected={true}
          projects={[]}
          selectedProjectId={null}
          onProjectChange={vi.fn()}
        />
      </MemoryRouter>,
    )
    const btn = screen.getByRole('button', { name: /model management/i })
    await userEvent.click(btn)
    expect(mockNavigate).toHaveBeenCalledWith('/models')
  })
})
