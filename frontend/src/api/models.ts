import { apiFetch } from './client'
import type { ModelPreset } from '../types'

export interface CreateModelPayload {
  name: string
  provider?: string
  model_id: string
  api_endpoint: string
  description?: string
  anthropic_compatible?: boolean | null
  supports_thinking?: boolean
}

export interface UpdateModelPayload {
  name?: string
  provider?: string
  model_id?: string
  api_endpoint?: string
  description?: string
  /** Pass undefined to leave unchanged, null to set auto-detect. */
  anthropic_compatible?: boolean | null | 'unset'
  supports_thinking?: boolean
}

export async function listModels(): Promise<ModelPreset[]> {
  return apiFetch<ModelPreset[]>('/models')
}

export async function createModel(payload: CreateModelPayload): Promise<ModelPreset> {
  return apiFetch<ModelPreset>('/models', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateModel(id: string, payload: UpdateModelPayload): Promise<ModelPreset> {
  return apiFetch<ModelPreset>(`/models/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteModel(id: string): Promise<void> {
  await apiFetch(`/models/${id}`, { method: 'DELETE' })
}

export async function reloadModels(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>('/models/reload', { method: 'POST' })
}
