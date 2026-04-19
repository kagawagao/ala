import { apiFetch } from './client'
import type { Project, CreateProjectRequest, ProjectFileInfo } from '../types'

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
