/** JSON-schema helpers shared by the ALA tools. */
import type { JsonSchema } from './context.ts'

export function objectSchema(
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}

export const stringArgument = (description: string): JsonSchema => ({
  type: 'string',
  description,
})

export const numberArgument = (description: string): JsonSchema => ({
  type: 'number',
  description,
})

export const booleanArgument = (description: string): JsonSchema => ({
  type: 'boolean',
  description,
})

/** Render a tool result as one JSON text block, matching how the model reads tool output. */
export function jsonContent(value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Read a required string argument with a clear error message. */
export function requiredString(args: unknown, key: string): string {
  const value = (args as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Argument "${key}" must be a non-empty string`)
  }
  return value
}

/** Read an optional string argument, treating blank strings as absent. */
export function optionalString(args: unknown, key: string): string | undefined {
  const value = (args as Record<string, unknown> | null)?.[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new Error(`Argument "${key}" must be a string`)
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** Read an optional integer argument, keeping "absent" distinct from 0. */
export function optionalNumber(args: unknown, key: string): number | null {
  const value = (args as Record<string, unknown> | null)?.[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Argument "${key}" must be a number`)
  }
  return Math.trunc(value)
}

/** Read an optional positive integer argument. */
export function optionalInt(
  args: unknown,
  key: string,
  fallback: number,
  limits: { min?: number; max?: number } = {},
): number {
  const value = (args as Record<string, unknown> | null)?.[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Argument "${key}" must be a number`)
  }
  const integer = Math.trunc(value)
  const min = limits.min ?? 0
  const max = limits.max ?? Number.MAX_SAFE_INTEGER
  return Math.min(max, Math.max(min, integer))
}
