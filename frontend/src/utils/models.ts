import { createModel } from '../api/models'
import type { AIConfig, ModelConfig, ModelPreset } from '../types'

export const MODEL_CONFIGS_STORAGE_KEY = 'ala_model_configs'

/** Dispatched on `window` whenever local model configs change. */
export const MODEL_CONFIGS_CHANGE_EVENT = 'ala:modelConfigsChange'

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
  window.dispatchEvent(new Event(MODEL_CONFIGS_CHANGE_EVENT))
}

export function deleteModelConfig(presetId: string): void {
  const all = loadModelConfigs()
  delete all[presetId]
  localStorage.setItem(MODEL_CONFIGS_STORAGE_KEY, JSON.stringify(all))
  window.dispatchEvent(new Event(MODEL_CONFIGS_CHANGE_EVENT))
}

// ── Active model helpers (multi-select) ────────────────────────────────────

/** @deprecated Active state is now stored in the backend via preset.enabled. */
export function getActiveModelIds(): string[] {
  try {
    const stored = localStorage.getItem('ala_active_models')
    return stored ? (JSON.parse(stored) as string[]) : []
  } catch {
    return []
  }
}

/** @deprecated use getActiveModelIds() instead */
export function getActiveModelId(): string | null {
  return getActiveModelIds()[0] ?? null
}

/** @deprecated use setModelEnabled() API instead */
export function setActiveModelId(_id: string): void {
  /* no-op: active state migrated to backend preset.enabled */
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
    thinking_mode: config.thinking_mode ?? (preset.supports_thinking ? 'auto' : 'off'),
    thinking_budget_tokens: config.thinking_budget_tokens ?? 8000,
    anthropic_compatible: preset.anthropic_compatible,
  }
}

/** Return the first enabled model that has a configured API key, or null. */
export function getActiveAIConfig(
  models: ModelPreset[],
): { config: AIConfig; preset: ModelPreset } | null {
  const configs = loadModelConfigs()
  const preset = models.find((m) => m.enabled && !!configs[m.id]?.api_key?.trim())
  if (!preset) return null
  return { config: buildAIConfig(preset, configs[preset.id] ?? {}), preset }
}

/**
 * One-time migration from the legacy global `aiConfig` localStorage key.
 * Finds the matching built-in preset (by model_id + api_endpoint) and saves
 * the api_key + settings under the per-model config store, setting it as active.
 * If no preset matches, skips (custom models are now managed by the backend).
 */
export function migrateFromLegacyConfig(models: ModelPreset[]): void {
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
      const existing = loadModelConfigs()
      // Only migrate if this preset has no key yet
      if (!existing[match.id]?.api_key?.trim()) {
        saveModelConfig(match.id, modelConfig)
      }
    }
  } catch {
    /* ignore */
  }
}

/** Return models that are enabled and have an API key configured in localStorage. */
export function filterConfiguredModels(models: ModelPreset[]): ModelPreset[] {
  const configs = loadModelConfigs()
  return models.filter((m) => m.enabled && !!configs[m.id]?.api_key?.trim())
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
