import { apiFetch, streamSSE } from './client'
import type { Session } from '../types'

export async function createSession(title: string, contextType: string): Promise<Session> {
  return apiFetch<Session>('/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({ title, context_type: contextType }),
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

export async function* sendMessage(
  sessionId: string,
  message: string,
  context?: string,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  yield* streamSSE(`/chat/sessions/${sessionId}/messages`, { message, context }, signal)
}
