import type { ModelPreset, ModelConfig, AIConfig } from '../types'

export const MODELS_STORAGE_KEY = 'ala_models'
export const MODEL_CONFIGS_STORAGE_KEY = 'ala_model_configs'
export const ACTIVE_MODELS_STORAGE_KEY = 'ala_active_models'

export const BUILTIN_MODELS: ModelPreset[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  {
    id: 'claude-opus-4.7',
    name: 'Claude Opus 4.7',
    provider: 'Anthropic',
    model_id: 'claude-opus-4-7',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Most capable, adaptive thinking',
    builtin: true,
    anthropic_compatible: true,
    supports_thinking: true,
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    provider: 'Anthropic',
    model_id: 'claude-sonnet-4-6',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Speed & intelligence, extended thinking',
    builtin: true,
    anthropic_compatible: true,
    supports_thinking: true,
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    provider: 'Anthropic',
    model_id: 'claude-haiku-4-5-20251001',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Fastest near-frontier',
    builtin: true,
    anthropic_compatible: true,
    supports_thinking: false,
  },
  // ── OpenAI ─────────────────────────────────────────────────────────────────
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'OpenAI',
    model_id: 'gpt-5.5',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Frontier, 1.05M context',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'OpenAI',
    model_id: 'gpt-5.4',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Unified Codex+GPT, 1.05M',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    model_id: 'gpt-4.1',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Flagship, 1M context',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'o3',
    name: 'o3',
    provider: 'OpenAI',
    model_id: 'o3',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Advanced reasoning',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    provider: 'OpenAI',
    model_id: 'o4-mini',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Compact reasoning',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  // ── Google Gemini ──────────────────────────────────────────────────────────
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    model_id: 'gemini-2.5-pro-preview-03-25',
    api_endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    description: 'Most capable Gemini',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: true,
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    model_id: 'gemini-2.5-flash-preview-04-17',
    api_endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    description: 'Fast & capable',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: true,
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    model_id: 'gemini-2.0-flash',
    api_endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    description: 'Fast, efficient',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  // ── DeepSeek ───────────────────────────────────────────────────────────────
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek-V4 Pro',
    provider: 'DeepSeek',
    model_id: 'deepseek-v4-pro',
    api_endpoint: 'https://api.deepseek.com',
    description: 'Flagship reasoning MoE',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: true,
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek-V4 Flash',
    provider: 'DeepSeek',
    model_id: 'deepseek-v4-flash',
    api_endpoint: 'https://api.deepseek.com',
    description: 'Fast & efficient',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: true,
  },
  // ── xAI (Grok) ─────────────────────────────────────────────────────────────
  {
    id: 'grok-4.20',
    name: 'Grok 4.20',
    provider: 'xAI',
    model_id: 'grok-4.20',
    api_endpoint: 'https://api.x.ai/v1',
    description: 'Flagship, 2M context',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: true,
  },
  {
    id: 'grok-4.1-fast',
    name: 'Grok 4.1 Fast',
    provider: 'xAI',
    model_id: 'grok-4-1-fast',
    api_endpoint: 'https://api.x.ai/v1',
    description: 'Fast, 2M context',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  // ── Mistral AI ─────────────────────────────────────────────────────────────
  {
    id: 'mistral-large',
    name: 'Mistral Large 3',
    provider: 'Mistral',
    model_id: 'mistral-large-latest',
    api_endpoint: 'https://api.mistral.ai/v1',
    description: 'Most capable Mistral',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'mistral-small',
    name: 'Mistral Small 4',
    provider: 'Mistral',
    model_id: 'mistral-small-latest',
    api_endpoint: 'https://api.mistral.ai/v1',
    description: 'Fast & efficient',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'codestral',
    name: 'Codestral',
    provider: 'Mistral',
    model_id: 'codestral-latest',
    api_endpoint: 'https://api.mistral.ai/v1',
    description: 'Code-optimised',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  // ── Cohere ─────────────────────────────────────────────────────────────────
  {
    id: 'command-r-plus',
    name: 'Command R+',
    provider: 'Cohere',
    model_id: 'command-r-plus',
    api_endpoint: 'https://api.cohere.com/v1',
    description: 'Advanced RAG',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  // ── Kimi (Moonshot AI) ─────────────────────────────────────────────────────
  {
    id: 'kimi-k2',
    name: 'Kimi K2',
    provider: 'Kimi',
    model_id: 'kimi-k2',
    api_endpoint: 'https://api.moonshot.cn/v1',
    description: 'Latest flagship',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'kimi-k2-thinking',
    name: 'Kimi K2 Thinking',
    provider: 'Kimi',
    model_id: 'kimi-k2-thinking',
    api_endpoint: 'https://api.moonshot.cn/v1',
    description: 'Extended reasoning',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  // ── MiniMax ────────────────────────────────────────────────────────────────
  {
    id: 'minimax-m2.7',
    name: 'MiniMax-M2.7',
    provider: 'MiniMax',
    model_id: 'minimax-m2.7',
    api_endpoint: 'https://api.minimax.io/v1',
    description: 'Latest',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  // ── Qwen (DashScope) ───────────────────────────────────────────────────────
  {
    id: 'qwen-max',
    name: 'Qwen Max',
    provider: 'Qwen',
    model_id: 'qwen-max-latest',
    api_endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    description: 'Most capable',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'Qwen',
    model_id: 'qwen-plus-latest',
    api_endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    description: 'Balanced',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
]

export function loadCustomModels(): ModelPreset[] {
  try {
    return JSON.parse(localStorage.getItem(MODELS_STORAGE_KEY) || '[]') as ModelPreset[]
  } catch {
    return []
  }
}

export function saveCustomModels(models: ModelPreset[]): void {
  localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models))
}

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

/**
 * Return all models (built-in + custom) that have a complete configuration:
 * model_id, api_endpoint, and an api_key stored in ala_model_configs.
 */
export function getConfiguredModels(): ModelPreset[] {
  const configs = loadModelConfigs()
  return [...BUILTIN_MODELS, ...loadCustomModels()].filter(
    (m) =>
      m.model_id.trim() !== '' && m.api_endpoint.trim() !== '' && !!configs[m.id]?.api_key?.trim(),
  )
}

// ── Per-model config storage ──────────────────────────────────────────────────

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

// ── Active model helpers (multi-select) ────────────────────────────────────────

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

export function findPresetById(id: string): ModelPreset | undefined {
  return [...BUILTIN_MODELS, ...loadCustomModels()].find((m) => m.id === id)
}

/** Build an AIConfig from a preset + its stored per-model config. */
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
export function getActiveAIConfig(): { config: AIConfig; preset: ModelPreset } | null {
  const id = getActiveModelId()
  if (!id) return null
  const preset = findPresetById(id)
  if (!preset) return null
  const configs = loadModelConfigs()
  return { config: buildAIConfig(preset, configs[id] ?? {}), preset }
}

/**
 * One-time migration from the legacy global `aiConfig` localStorage key.
 * Finds the matching built-in preset (by model_id + api_endpoint) and saves
 * the api_key + settings under the per-model config store, setting it as active.
 * If no preset matches, creates a new custom model.
 */
export function migrateFromLegacyConfig(): void {
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
    const all = [...BUILTIN_MODELS, ...loadCustomModels()]
    const match = all.find((m) => m.model_id === cfg.model && m.api_endpoint === cfg.api_endpoint)
    if (match) {
      saveModelConfig(match.id, modelConfig)
      setActiveModelId(match.id)
    } else {
      // Create a custom preset for this legacy config
      const id = `migrated-${Date.now()}`
      const newPreset: ModelPreset = {
        id,
        name: cfg.model,
        provider: 'Custom',
        model_id: cfg.model,
        api_endpoint: cfg.api_endpoint,
      }
      saveCustomModels([...loadCustomModels(), newPreset])
      saveModelConfig(id, modelConfig)
      setActiveModelId(id)
    }
  } catch {
    /* ignore */
  }
}
