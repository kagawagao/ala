import type { ModelPreset } from '../types'

export const MODELS_STORAGE_KEY = 'ala_models'

export const BUILTIN_MODELS: ModelPreset[] = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'Anthropic',
    model_id: 'claude-opus-4-20250514',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Most capable',
    builtin: true,
    anthropic_compatible: true,
    supports_thinking: true,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    model_id: 'claude-sonnet-4-20250514',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Balanced',
    builtin: true,
    anthropic_compatible: true,
    supports_thinking: true,
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    model_id: 'claude-3-5-sonnet-20241022',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Previous generation',
    builtin: true,
    anthropic_compatible: true,
    supports_thinking: false,
  },
  {
    id: 'claude-haiku-3-5',
    name: 'Claude Haiku 3.5',
    provider: 'Anthropic',
    model_id: 'claude-haiku-3-5-20241022',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Fast & efficient',
    builtin: true,
    anthropic_compatible: true,
    supports_thinking: false,
  },
  // ── OpenAI ─────────────────────────────────────────────────────────────────
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    model_id: 'gpt-4o',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Multimodal flagship',
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
    description: 'Latest GPT-4.1',
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
    description: 'Reasoning, efficient',
    builtin: true,
    anthropic_compatible: false,
    supports_thinking: false,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'OpenAI',
    model_id: 'gpt-4o-mini',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Fast & cheap',
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
  {
    id: 'moonshot-v1-128k',
    name: 'Moonshot V1 128K',
    provider: 'Kimi',
    model_id: 'moonshot-v1-128k',
    api_endpoint: 'https://api.moonshot.cn/v1',
    description: 'Long context',
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
  {
    id: 'minimax-m2.5',
    name: 'MiniMax-M2.5',
    provider: 'MiniMax',
    model_id: 'minimax-m2.5',
    api_endpoint: 'https://api.minimax.io/v1',
    description: 'High performance',
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
  {
    id: 'qwen-turbo',
    name: 'Qwen Turbo',
    provider: 'Qwen',
    model_id: 'qwen-turbo-latest',
    api_endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    description: 'Fast',
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
 * Return all models (built-in + custom) that have a complete configuration,
 * i.e., both model_id and api_endpoint are non-empty strings.
 */
export function getConfiguredModels(): ModelPreset[] {
  const custom = loadCustomModels()
  return [...BUILTIN_MODELS, ...custom].filter(
    (m) => m.model_id.trim() !== '' && m.api_endpoint.trim() !== '',
  )
}
