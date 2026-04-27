import { apiFetch, streamSSE } from './client'
import type { Session } from '../types'

export async function createSession(
  title: string,
  contextType: string,
  projectId?: string | null,
): Promise<Session> {
  return apiFetch<Session>('/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({ title, context_type: contextType, project_id: projectId || null }),
  })
}

export async function listSessions(): Promise<Session[]> {
  return apiFetch<Session[]>('/chat/sessions')
}

export async function getSession(sessionId: string): Promise<Session> {
  return apiFetch<Session>(`/chat/sessions/${sessionId}`)
}

export async function deleteSession(sessionId: string): Promise<void> {
  await apiFetch(`/chat/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function setSessionTrace(
  sessionId: string,
  summary: Record<string, unknown>,
): Promise<void> {
  await apiFetch(`/chat/sessions/${sessionId}/trace`, {
    method: 'PUT',
    body: JSON.stringify({ summary }),
  })
}

export async function setSessionFilePath(sessionId: string, filePath: string): Promise<void> {
  await apiFetch(`/chat/sessions/${sessionId}/file-path`, {
    method: 'PUT',
    body: JSON.stringify({ file_path: filePath }),
  })
}

export async function setSessionLogs(
  sessionId: string,
  entries: Record<string, unknown>[],
): Promise<void> {
  await apiFetch(`/chat/sessions/${sessionId}/logs`, {
    method: 'PUT',
    body: JSON.stringify({ entries }),
  })
}

export async function* sendMessage(
  sessionId: string,
  message: string,
  context?: string,
  signal?: AbortSignal,
  modelOverride?: {
    model: string
    api_endpoint: string
    api_key?: string
    temperature?: number
    thinking_mode?: string
    thinking_budget_tokens?: number
    anthropic_compatible?: boolean
  },
): AsyncGenerator<string> {
  yield* streamSSE(
    `/chat/sessions/${sessionId}/messages`,
    { message, context, model_override: modelOverride ?? null },
    signal,
  )
}
