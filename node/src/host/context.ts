/** Minimal structural types for the DSH services this bundle uses. */
export interface JsonSchema {
  type?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  additionalProperties?: boolean | JsonSchema
}

export type ToolContent = { type: 'text'; text: string } | { type: 'image'; attachment: unknown }

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
  output: { schema: JsonSchema; render(args: unknown, value: unknown): ToolContent[] }
  execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
}

/** Runtime skill contribution accepted by `ctx.skills.register()`. */
export interface SkillRegistration {
  name: string
  description: string
  content: string
  source: string
  whenToUse?: string
  resourceBase?: { kind: 'directory'; path: string }
}

/** The subset of a Cordis context this bundle needs; keeps the package dependency-free at runtime. */
export interface AlaHostContext {
  tools: { register(definition: ToolDefinition): () => void }
  skills?: { register(skill: SkillRegistration): () => void }
  effect?(setup: () => () => void): unknown
  logger?: {
    info(message: string, ...args: unknown[]): void
    warn(message: string, ...args: unknown[]): void
  }
}
