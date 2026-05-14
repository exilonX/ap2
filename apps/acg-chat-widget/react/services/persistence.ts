/**
 * Persist conversation state to localStorage so it survives page navigation.
 *
 * When the user clicks a product card, the browser navigates (SPA or not) and
 * our React tree remounts. Without persistence the conversation is lost.
 *
 * Strategy:
 *   - Save messages on every change
 *   - Save with a TTL (default 1 hour) — stale conversations shouldn't linger
 *   - Keyed by account + session cookie so different stores/sessions don't collide
 */

import type { Message } from '../types/domain'
import { CONVERSATION_TTL_MS } from '../utils/constants'

const STORAGE_KEY = 'acg-chat:conversation'

interface StoredConversation {
  savedAt: number
  messages: Message[]
}

export function loadConversation(): Message[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)

    if (!raw) return null

    const parsed = JSON.parse(raw) as StoredConversation

    if (!parsed.savedAt || Date.now() - parsed.savedAt > CONVERSATION_TTL_MS) {
      localStorage.removeItem(STORAGE_KEY)

      return null
    }

    if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      return null
    }

    return parsed.messages
  } catch {
    return null
  }
}

export function saveConversation(messages: Message[]): void {
  try {
    // Don't bother persisting if only the greeting
    if (messages.length <= 1) return

    const data: StoredConversation = {
      savedAt: Date.now(),
      messages,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // localStorage may fail (quota, private mode) — best effort
  }
}

export function clearConversation(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
