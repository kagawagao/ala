import { apiFetch } from './client'
import type { AIConfig } from '../types'

export async function getConfig(): Promise<AIConfig> {
  return apiFetch<AIConfig>('/config')
}

export async function updateConfig(config: AIConfig): Promise<void> {
  await apiFetch('/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}
