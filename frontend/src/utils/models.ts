import type { ModelPreset, ModelConfig, AIConfig } from '../types'

export const MODEL_CONFIGS_STORAGE_KEY = 'ala_model_configs'
export const ACTIVE_MODELS_STORAGE_KEY = 'ala_active_models'

/** Group an array of ModelPreset objects by their provider field. */
export function groupByProvider(models: ModelPreset[]): [string, ModelPreset[]][] {
  const map = new Map<string, ModelPreset[]>()
  for (const m of models) {
    const group = map.get(m.provider) ?? []
    group.push(m)
    map.set(m.provider, group)
  }
  return Array.from(map.entries())
}

// ── Per-model config storage (API keys live in localStorage, not backend) ──

export function loadModelConfigs(): Record<string, Partial<ModelConfig>> {
  try {
    return JSON.parse(localStorage.getItem(MODEL_CONFIGS_STORAGE_KEY) || '{}') as Record<
      string,
      Partial<ModelConfig>
    >
  } catch {
    return {}
  }
}

export function saveModelConfig(presetId: string, config: Partial<ModelConfig>): void {
  const all = loadModelConfigs()
  all[presetId] = { ...all[presetId], ...config }
  localStorage.setItem(MODEL_CONFIGS_STORAGE_KEY, JSON.stringify(all))
}

export function deleteModelConfig(presetId: string): void {
  const all = loadModelConfigs()
  delete all[presetId]
  localStorage.setItem(MODEL_CONFIGS_STORAGE_KEY, JSON.stringify(all))
}

// ── Active model helpers (multi-select) ────────────────────────────────────

export function getActiveModelIds(): string[] {
  // Backward compat: migrate old single ID to array
  const old = localStorage.getItem('ala_active_model_id')
  if (old) {
    localStorage.removeItem('ala_active_model_id')
    const ids = [old]
    localStorage.setItem(ACTIVE_MODELS_STORAGE_KEY, JSON.stringify(ids))
    return ids
  }
  try {
    const stored = localStorage.getItem(ACTIVE_MODELS_STORAGE_KEY)
    return stored ? (JSON.parse(stored) as string[]) : []
  } catch {
    return []
  }
}

export function isModelActive(id: string): boolean {
  return getActiveModelIds().includes(id)
}

export function toggleActiveModel(id: string): string[] {
  const ids = getActiveModelIds()
  const idx = ids.indexOf(id)
  if (idx >= 0) {
    ids.splice(idx, 1)
  } else {
    ids.push(id)
  }
  localStorage.setItem(ACTIVE_MODELS_STORAGE_KEY, JSON.stringify(ids))
  return ids
}

/** @deprecated use getActiveModelIds() instead */
export function getActiveModelId(): string | null {
  return getActiveModelIds()[0] ?? null
}

/** @deprecated use toggleActiveModel() instead */
export function setActiveModelId(id: string): void {
  const ids = getActiveModelIds()
  if (!ids.includes(id)) {
    ids.push(id)
    localStorage.setItem(ACTIVE_MODELS_STORAGE_KEY, JSON.stringify(ids))
  }
}

export function findPresetById(id: string, models: ModelPreset[]): ModelPreset | undefined {
  return models.find((m) => m.id === id)
}

/** Build an AIConfig from a preset + its stored per-model config (API key from localStorage). */
export function buildAIConfig(preset: ModelPreset, config: Partial<ModelConfig>): AIConfig {
  return {
    api_endpoint: preset.api_endpoint,
    api_key: config.api_key ?? '',
    model: preset.model_id,
    temperature: config.temperature ?? 0.7,
    thinking_mode: config.thinking_mode ?? 'off',
    thinking_budget_tokens: config.thinking_budget_tokens ?? 8000,
    anthropic_compatible: preset.anthropic_compatible,
  }
}

/** Return the active model's derived AIConfig, or null if none is set. */
export function getActiveAIConfig(
  models: ModelPreset[],
): { config: AIConfig; preset: ModelPreset } | null {
  const id = getActiveModelId()
  if (!id) return null
  const preset = findPresetById(id, models)
  if (!preset) return null
  const configs = loadModelConfigs()
  return { config: buildAIConfig(preset, configs[id] ?? {}), preset }
}

/**
 * One-time migration from the legacy global `aiConfig` localStorage key.
 * Finds the matching built-in preset (by model_id + api_endpoint) and saves
 * the api_key + settings under the per-model config store, setting it as active.
 * If no preset matches, skips (custom models are now managed by the backend).
 */
export function migrateFromLegacyConfig(models: ModelPreset[]): void {
  if (getActiveModelId()) return // already migrated
  const saved = localStorage.getItem('aiConfig')
  if (!saved) return
  try {
    const cfg = JSON.parse(saved) as AIConfig
    if (!cfg.api_key) return
    const modelConfig: Partial<ModelConfig> = {
      api_key: cfg.api_key,
      temperature: cfg.temperature,
      thinking_mode: cfg.thinking_mode,
      thinking_budget_tokens: cfg.thinking_budget_tokens,
    }
    const match = models.find(
      (m) => m.model_id === cfg.model && m.api_endpoint === cfg.api_endpoint,
    )
    if (match) {
      saveModelConfig(match.id, modelConfig)
      setActiveModelId(match.id)
    }
  } catch {
    /* ignore */
  }
}

/** Return models that have an API key configured in localStorage. */
export function filterConfiguredModels(models: ModelPreset[]): ModelPreset[] {
  const configs = loadModelConfigs()
  return models.filter((m) => !!configs[m.id]?.api_key?.trim())
}

// ── Backwards-compatibility shims (removed localStorage model storage) ──────

/** @deprecated Custom models are now managed by the backend API. */
export function loadCustomModels(): ModelPreset[] {
  // Migrate any previously saved custom models once (data from ala_models)
  try {
    const saved = localStorage.getItem('ala_models')
    if (saved) return JSON.parse(saved) as ModelPreset[]
  } catch {
    /* ignore */
  }
  return []
}
