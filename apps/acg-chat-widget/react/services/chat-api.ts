/**
 * POST /_v/acg/chat — the LLM tool-call loop.
 *
 * Transport-level failures throw; HTTP non-2xx throws; backend-shaped
 * responses come back as the destructured fields the widget renders.
 * Dev-only network-failure fallback to a keyword mock lives in
 * `./dev-fallback.ts` and only fires on transport errors (no backend
 * reachable).
 */

import type { Message } from '../types/domain'
import type {
  ChatAPIResponse,
  HistoryEntry,
  SendChatResult,
} from '../types/api'
import { HISTORY_HEAD_TURNS, HISTORY_MAX_TURNS } from '../utils/constants'
import { fallbackToMock } from './dev-fallback'
import { getOrderFormIdFromCookie, triggerCartRefresh } from './cart-refresh'

/**
 * Build the prior-turn payload the chat backend uses to reconstruct
 * conversation context.
 *
 * Two responsibilities:
 *
 * 1. **Strip the trailing duplicate of the new turn.** The widget
 *    appends the new user message to its local `messages` array BEFORE
 *    calling `sendChatMessage` (optimistic UI). The backend separately
 *    receives the new text in `body.message`. Without this guard the
 *    LLM would see the new turn twice.
 *
 * 2. **Pin the opening exchange.** A naive `slice(-N)` sliding window
 *    drops the first user turn once the conversation grows past N. In
 *    practice that first turn is where the durable intent lives
 *    ("haine bărbați", "cadou copil", budget ceilings). We keep the
 *    first HEAD_TURNS entries and the most recent MAX_TURNS - HEAD_TURNS
 *    entries — total stays at MAX_TURNS so per-call token cost is
 *    unchanged.
 *
 * Known limitation: only `{ role, content }` survives the hop. Tool
 * calls and tool results from prior turns are lost across calls — the
 * LLM has to re-call tools to re-acquire variant data, last search
 * results, etc. Tracked in ISSUES.md #0004.
 */
export function buildHistory(
  messages: Message[],
  currentUserMessage: string
): HistoryEntry[] {
  // Drop the optimistic trailing duplicate of the new turn.
  const last = messages[messages.length - 1]
  const dropLast =
    last && last.role === 'user' && last.content === currentUserMessage
  const available = dropLast ? messages.slice(0, -1) : messages

  if (available.length <= HISTORY_MAX_TURNS) {
    return available.map(toHistoryEntry)
  }

  // Skip leading assistant turns when picking the anchor — the canned
  // greeting carries no intent. Start the head at the first user turn.
  const firstUserIdx = available.findIndex((m) => m.role === 'user')
  const headStart = firstUserIdx === -1 ? 0 : firstUserIdx
  const head = available.slice(headStart, headStart + HISTORY_HEAD_TURNS)
  const tailSize = HISTORY_MAX_TURNS - head.length
  const tail = available.slice(-tailSize)

  return [...head, ...tail].map(toHistoryEntry)
}

function toHistoryEntry(m: Message): HistoryEntry {
  return { role: m.role, content: m.content }
}

export async function sendChatMessage(
  userMessage: string,
  conversationHistory: Message[]
): Promise<SendChatResult> {
  const orderFormId = getOrderFormIdFromCookie()

  let response: Response

  try {
    response = await fetch('/_v/acg/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        message: userMessage,
        history: buildHistory(conversationHistory, userMessage),
        orderFormId,
      }),
    })
  } catch (error) {
    // Network-level failure (no backend, DNS, etc.) — dev-time fallback to mock.
    console.error('[ACG Chat] Network error:', error)

    return fallbackToMock(userMessage)
  }

  if (!response.ok) {
    // Backend reachable but returned an error (5xx from upstream LLM, validation
    // failure, etc.). Throw so the widget shows the localized errorConnection
    // message in the user's language instead of the English mock fallback.
    const errorData = await response.json().catch(() => ({}))

    console.error('[ACG Chat] API error:', response.status, errorData)
    throw new Error(`Chat backend returned ${response.status}`)
  }

  try {
    const data: ChatAPIResponse = await response.json()

    if (data.cartUpdated) {
      triggerCartRefresh()
    }

    return {
      content: data.reply,
      products: data.products,
      suggestions: data.suggestions,
      cartPreview: data.cartPreview,
      cartUpdated: data.cartUpdated,
      mandate: data.mandate,
      paymentMethods: data.paymentMethods,
    }
  } catch (error) {
    // JSON parse failure on a 200 response — server returned malformed body.
    // Throw so the widget shows the localized error.
    console.error('[ACG Chat] Response parse error:', error)
    throw error
  }
}
