import { apiFetch, streamSSE } from './client'
import type {
  Project,
  CreateProjectRequest,
  ProjectFileInfo,
  ContextDoc,
  FilterPreset,
} from '../types'

export async function createProject(req: CreateProjectRequest): Promise<Project> {
  return apiFetch<Project>('/projects', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export async function listProjects(): Promise<Project[]> {
  return apiFetch<Project[]>('/projects')
}

export async function getProject(projectId: string): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}`)
}

export async function updateProject(
  projectId: string,
  req: Partial<CreateProjectRequest>,
): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}`, {
    method: 'PUT',
    body: JSON.stringify(req),
  })
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}`, { method: 'DELETE' })
}

export async function listProjectFiles(
  projectId: string,
  subdirectory?: string,
): Promise<ProjectFileInfo[]> {
  const params = subdirectory ? `?subdirectory=${encodeURIComponent(subdirectory)}` : ''
  return apiFetch<ProjectFileInfo[]>(`/projects/${projectId}/files${params}`)
}

export async function listContextDocs(projectId: string): Promise<ContextDoc[]> {
  return apiFetch<ContextDoc[]>(`/projects/${projectId}/context-docs`)
}

export async function* generateFilters(
  projectId: string,
  existingFilters?: object[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const body: Record<string, unknown> = {}
  if (existingFilters && existingFilters.length > 0) {
    body.existing_filters = existingFilters
  }
  yield* streamSSE(`/projects/${projectId}/generate-filters`, body, signal)
}

export async function getProjectPresets(projectId: string): Promise<FilterPreset[]> {
  return apiFetch<FilterPreset[]>(`/projects/${projectId}/presets`)
}

export async function updateProjectPresets(
  projectId: string,
  presets: FilterPreset[],
): Promise<FilterPreset[]> {
  return apiFetch<FilterPreset[]>(`/projects/${projectId}/presets`, {
    method: 'PUT',
    body: JSON.stringify({ presets }),
  })
}
