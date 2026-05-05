import type {
  AgentEvent,
  LogEntry,
  ToolCallEvent,
  ToolResultEvent,
  ThinkingEvent,
  MaxRoundsReachedEvent,
} from '../types'

// ── Types ────────────────────────────────────────────────────────────────

export interface ToolCallInfo {
  name: string
  arguments: string
  result?: string
}

export type MessagePart =
  | { type: 'text'; content: string }
  | { type: 'tool'; call: ToolCallInfo }
  | { type: 'thinking'; content: string }

export interface SSEParseState {
  parts: MessagePart[]
  accumulated: string
  continueMessage: string | null
}

// ── Helpers ──────────────────────────────────────────────────────────────

function appendText(parts: MessagePart[], delta: string): MessagePart[] {
  const last = parts[parts.length - 1]
  if (last?.type === 'text') {
    return [...parts.slice(0, -1), { type: 'text', content: last.content + delta }]
  }
  return [...parts, { type: 'text', content: delta }]
}

// ── Tool log entry extractor ─────────────────────────────────────────────

/**
 * Extract log entries from a tool_result content string when the tool is
 * search_local_log or read_log_range.  Returns an empty array for other
 * tools or when parsing fails.
 */
export function extractToolLogEntries(toolName: string, content: string): LogEntry[] {
  if (toolName !== 'search_local_log' && toolName !== 'read_log_range') return []
  try {
    const parsed = JSON.parse(content)
    if (parsed.entries && Array.isArray(parsed.entries)) {
      return parsed.entries as LogEntry[]
    }
  } catch {
    /* ignore parse failures */
  }
  return []
}

// ── Core processor ───────────────────────────────────────────────────────

export function processSSEChunk(chunk: string, state: SSEParseState): SSEParseState {
  // [DONE] signal — no change (caller handles loop termination)
  if (chunk === '[DONE]') return state

  // Fast path: plain text chunks (95%+ of events) skip JSON.parse
  if (!chunk.startsWith('{')) {
    return {
      ...state,
      accumulated: state.accumulated + chunk,
      parts: appendText(state.parts, chunk),
    }
  }

  try {
    const data = JSON.parse(chunk) as AgentEvent | Record<string, unknown>

    // ── Structured event types ───────────────────────────────────────────

    if ('type' in data && data.type === 'thinking') {
      return {
        ...state,
        parts: [...state.parts, { type: 'thinking', content: (data as ThinkingEvent).content }],
      }
    }

    if ('type' in data && data.type === 'tool_call') {
      const event = data as ToolCallEvent
      return {
        ...state,
        parts: [
          ...state.parts,
          { type: 'tool', call: { name: event.name, arguments: event.arguments } },
        ],
      }
    }

    if ('type' in data && data.type === 'tool_result') {
      const event = data as ToolResultEvent
      // Match most recent unresolved tool by name (reverse search)
      const idx = [...state.parts]
        .reverse()
        .findIndex((p) => p.type === 'tool' && p.call.name === event.name && !p.call.result)
      if (idx !== -1) {
        const realIdx = state.parts.length - 1 - idx
        const updated = [...state.parts]
        updated[realIdx] = {
          type: 'tool',
          call: {
            ...(state.parts[realIdx] as { type: 'tool'; call: ToolCallInfo }).call,
            result: event.content,
          },
        }
        return { ...state, parts: updated }
      }
      return state
    }

    if ('type' in data && data.type === 'max_rounds_reached') {
      return { ...state, continueMessage: (data as MaxRoundsReachedEvent).message }
    }

    // agent_meta — silently discard
    if ('type' in data && data.type === 'agent_meta') {
      return state
    }

    // ── OpenAI-compatible delta extraction ────────────────────────────────
    const delta =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data as any).choices?.[0]?.delta?.content ||
      (data as Record<string, unknown>).content ||
      chunk

    if (typeof delta === 'string' && delta) {
      return {
        accumulated: state.accumulated + delta,
        parts: appendText(state.parts, delta),
        continueMessage: state.continueMessage,
      }
    }

    return state
  } catch {
    // JSON.parse failed — treat chunk as plain text
    return {
      accumulated: state.accumulated + chunk,
      parts: appendText(state.parts, chunk),
      continueMessage: state.continueMessage,
    }
  }
}

// ── Initial state factory ────────────────────────────────────────────────

export function createSSEState(): SSEParseState {
  return { parts: [], accumulated: '', continueMessage: null }
}
