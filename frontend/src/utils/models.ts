import { createModel } from '../api/models'
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

/**
 * One-time migration: move custom models saved in the old `ala_models` localStorage key
 * to the backend. Skips models already present (matched by model_id + api_endpoint).
 * Returns the array of model presets that were successfully created on the backend.
 * Models whose creation failed are restored to localStorage for retry on next load.
 */
export async function migrateLocalModelsToBackend(
  existingModels: ModelPreset[],
): Promise<ModelPreset[]> {
  const LEGACY_KEY = 'ala_models'
  let old: ModelPreset[]
  try {
    const saved = localStorage.getItem(LEGACY_KEY)
    if (!saved) return []
    old = JSON.parse(saved) as ModelPreset[]
    if (!Array.isArray(old) || old.length === 0) {
      localStorage.removeItem(LEGACY_KEY)
      return []
    }
    // Claim the migration synchronously BEFORE any await so that a concurrent
    // second call (e.g. React StrictMode double-invoke) finds the key gone and
    // bails out, preventing duplicate model creation.
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    return []
  }

  const existingKeys = new Set(existingModels.map((m) => `${m.model_id}|${m.api_endpoint}`))
  const toMigrate = old.filter((m) => !existingKeys.has(`${m.model_id}|${m.api_endpoint}`))

  const created: ModelPreset[] = []
  const failed: ModelPreset[] = []
  for (const m of toMigrate) {
    try {
      const preset = await createModel({
        name: m.name,
        provider: m.provider ?? 'Custom',
        model_id: m.model_id,
        api_endpoint: m.api_endpoint,
        description: m.description,
        anthropic_compatible: m.anthropic_compatible ?? null,
        supports_thinking: m.supports_thinking ?? false,
      })
      created.push(preset)
    } catch {
      failed.push(m)
    }
  }

  // Restore models that failed to migrate so they are retried on next load
  if (failed.length > 0) {
    localStorage.setItem(LEGACY_KEY, JSON.stringify(failed))
  }

  return created
}
