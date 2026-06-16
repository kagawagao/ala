/** IndexedDB-backed session message persistence.
 *
 * Sessions are stored in a single "ala_sessions" database with one object
 * store ("sessions") keyed by session ID.  Each record holds the chat
 * message list plus optional raw API messages for tool-call resumption.
 */

import type { ChatMessage } from '../types'

// ── Types ──────────────────────────────────────────────────────────────────

export interface LocalSessionState {
  messages: ChatMessage[]
  rawApiMessages: Record<string, unknown>[] | null
  rawApiMessagesProvider: string | null
}

// ── DB helpers ─────────────────────────────────────────────────────────────

const DB_NAME = 'ala_sessions'
const STORE_NAME = 'sessions'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const request = fn(store)

    request.onerror = () => reject(request.error)

    // Guard against transaction-level failures (e.g. quota exceeded)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)

    tx.oncomplete = () => {
      resolve(request.result)
      db.close()
    }
  })
}

// ── Public API ─────────────────────────────────────────────────────────────

export function getLocalSessionState(sessionId: string): Promise<LocalSessionState | null> {
  return withStore<LocalSessionState | undefined>(
    'readonly',
    (store) => store.get(sessionId) as IDBRequest<LocalSessionState | undefined>,
  ).then((result) => result ?? null)
}

export function setLocalSessionState(sessionId: string, state: LocalSessionState): Promise<void> {
  return withStore<IDBValidKey>('readwrite', (store) => store.put({ sessionId, ...state })).then(
    () => undefined,
  )
}

export function removeLocalSessionState(sessionId: string): Promise<void> {
  return withStore<undefined>('readwrite', (store) => store.delete(sessionId)).then(() => undefined)
}

export function clearAllLocalSessionStates(): Promise<void> {
  return withStore<undefined>('readwrite', (store) => store.clear()).then(() => undefined)
}

/** Convenience: return just the message list for a session. */
export async function getLocalSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const state = await getLocalSessionState(sessionId)
  return state?.messages ?? []
}
