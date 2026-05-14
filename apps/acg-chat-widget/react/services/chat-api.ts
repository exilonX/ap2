/**
 * POST /_v/acg/chat — the LLM tool-call loop.
 *
 * Transport-level failures throw; HTTP non-2xx throws; backend-shaped
 * responses come back as the destructured fields the widget renders.
 * Dev-only network-failure fallback to a keyword mock lives in
 * `./dev-fallback.ts` and only fires on transport errors (no backend
 * reachable).
 */

import type {
  CartPreview,
  Mandate,
  Message,
  ProductCard,
} from '../types/domain'
import type { ChatAPIResponse, HistoryEntry } from '../types/api'
import { fallbackToMock } from './dev-fallback'
import { getOrderFormIdFromCookie, triggerCartRefresh } from './cart-refresh'

function buildHistory(
  messages: Message[],
  currentUserMessage: string
): HistoryEntry[] {
  // The widget pushes the new user message into messages BEFORE calling the API,
  // and the backend also appends `body.message` itself. Drop the trailing user
  // turn if it matches what we're about to send to avoid a duplicate role:user.
  const last = messages[messages.length - 1]
  const dropLast =
    last && last.role === 'user' && last.content === currentUserMessage
  const slice = dropLast ? messages.slice(-11, -1) : messages.slice(-10)

  return slice.map((m) => ({ role: m.role, content: m.content }))
}

export interface SendChatResult {
  content: string
  products?: ProductCard[]
  suggestions?: string[]
  cartPreview?: CartPreview
  cartUpdated?: boolean
  mandate?: Mandate
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
    }
  } catch (error) {
    // JSON parse failure on a 200 response — server returned malformed body.
    // Throw so the widget shows the localized error.
    console.error('[ACG Chat] Response parse error:', error)
    throw error
  }
}
