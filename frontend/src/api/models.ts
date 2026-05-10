import type { ModelPreset } from '../types'
import { apiFetch } from './client'

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
  const presets = await apiFetch<ModelPreset[]>('/models')
  // Normalize null → undefined for consistent frontend handling
  // (the backend uses None/null to represent "auto-detect", but the
  // TypeScript type uses optional boolean)
  return presets.map((p) => ({
    ...p,
    anthropic_compatible: p.anthropic_compatible ?? undefined,
  }))
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

export async function setModelEnabled(id: string, enabled: boolean): Promise<ModelPreset> {
  return apiFetch<ModelPreset>(`/models/${id}/enabled`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  })
}
