import type { CartPreview, Mandate, Message, ProductCard } from './types'
import { getMockResponse } from './mockResponses'

/**
 * Result shape from POST /_v/acg/payment/execute — mirrors the iframe's
 * parsed-tool-result. The handler always returns HTTP 200 (the AP2
 * ceremony succeeded *as a process* even when it rejected) so success
 * vs failure is on the body's `success` field.
 */
export interface PaymentResult {
  success: boolean
  // success-only fields
  orderId?: string
  mandateId?: string
  signedBy?: string
  cartTotal?: number
  cartCurrency?: string
  paymentMandate?: unknown
  paymentMandateId?: string
  paymentMandateUrl?: string
  // success + rejection-with-receipt fields
  paymentReceipt?: {
    contents: {
      receipt_id: string
      approval_status: 'approved' | 'rejected'
      rejection_reason?: string
      verification_checks: {
        merchant_signature: boolean
        cp_signature: boolean
        hash_binding: boolean
        amount_consistency: boolean
        mandate_id_linking: boolean
        payment_mandate_not_expired: boolean
        cart_mandate_not_expired: boolean
      }
    }
    network_authorization: string
  }
  paymentReceiptId?: string
  paymentReceiptUrl?: string
  mockCpDid?: string
  mockNetworkDid?: string
  // failure-only fields
  reason?: string
  drifted?: boolean
}

/**
 * Run the AP2 payment ceremony — re-verify the signed mandate against the
 * live cart, sign PaymentMandate via the mock CP, run the 7-check chain
 * via the mock Network, emit a signed PaymentReceipt (approved OR
 * rejected — always-emit invariant). The browser-side widget calls this
 * directly via fetch (same as the iframe in Claude Desktop calls it via MCP).
 *
 * Network/transport failures throw. Tool-level failures (drift, network
 * rejection) come back as `success: false` with a `reason` (and a
 * `paymentReceipt` if the chain reached the network).
 */
export async function executePayment(mandateId: string): Promise<PaymentResult> {
  const response = await fetch('/_v/acg/payment/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ mandateId }),
  })

  if (!response.ok && response.status !== 200) {
    throw new Error(`Payment execute returned ${response.status}`)
  }

  const data: PaymentResult = await response.json()
  return data
}

interface ChatAPIResponse {
  reply: string
  products?: Array<{
    productId: string
    name: string
    imageUrl: string
    price: number
    listPrice?: number
    discountPct?: number
    onSale?: boolean
    currency: string
    url: string
    groupLabel?: string
  }>
  suggestions?: string[]
  cartPreview?: CartPreview
  cartUpdated?: boolean
  mandate?: Mandate
  error?: string
}

interface HistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

function getBaseUrl(): string {
  return ''
}

function buildHistory(messages: Message[], currentUserMessage: string): HistoryEntry[] {
  // The widget pushes the new user message into messages BEFORE calling the API,
  // and the backend also appends `body.message` itself. Drop the trailing user
  // turn if it matches what we're about to send to avoid a duplicate role:user.
  const last = messages[messages.length - 1]
  const dropLast = last && last.role === 'user' && last.content === currentUserMessage
  const slice = dropLast ? messages.slice(-11, -1) : messages.slice(-10)

  return slice.map((m) => ({ role: m.role, content: m.content }))
}

/**
 * Read the orderFormId from the VTEX checkout cookie.
 * This lets the chat widget operate on the SAME cart as the store.
 */
function getOrderFormIdFromCookie(): string | null {
  try {
    const cookies = document.cookie.split(';')

    for (const cookie of cookies) {
      const trimmed = cookie.trim()

      if (trimmed.startsWith('checkout.vtex.com')) {
        const match = trimmed.match(/__ofid=([^;]+)/)

        if (match) {
          return match[1]
        }
      }
    }
  } catch {
    // Cookie access might fail in some contexts
  }

  return null
}

/**
 * Trigger the store's mini-cart to refetch the orderForm.
 * VTEX Store Framework listens to these events.
 */
function triggerCartRefresh(): void {
  try {
    // Method 1: VTEX pixel event — Store Framework mini-cart listens to addToCart events
    window.postMessage(
      {
        event: 'addToCart',
        eventName: 'vtex:cartChanged',
        items: [],
      },
      '*'
    )

    // Method 2: Dispatch custom event for any listeners
    window.dispatchEvent(new CustomEvent('acg:cartUpdated'))

    // Method 3: Force orderForm refetch via VTEX checkout API
    // This makes the mini-cart badge update immediately
    const orderFormId = getOrderFormIdFromCookie()

    if (orderFormId) {
      fetch(`/api/checkout/pub/orderForm/${orderFormId}`, {
        method: 'GET',
        credentials: 'same-origin',
      }).catch(() => {
        // Silent fail — just a refresh hint
      })
    }
  } catch {
    // Best effort
  }
}

export async function sendChatMessage(
  userMessage: string,
  conversationHistory: Message[]
): Promise<{
  content: string
  products?: ProductCard[]
  suggestions?: string[]
  cartPreview?: CartPreview
  cartUpdated?: boolean
  mandate?: Mandate
}> {
  const baseUrl = getBaseUrl()
  const orderFormId = getOrderFormIdFromCookie()

  let response: Response

  try {
    response = await fetch(`${baseUrl}/_v/acg/chat`, {
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

    // If the backend modified the cart, trigger a refresh so the store's mini-cart updates
    if (data.cartUpdated) {
      triggerCartRefresh()
    }

    const products: ProductCard[] | undefined = data.products?.map((p) => ({
      productId: p.productId,
      name: p.name,
      imageUrl: p.imageUrl,
      price: p.price,
      listPrice: p.listPrice,
      discountPct: p.discountPct,
      onSale: p.onSale,
      currency: p.currency,
      url: p.url,
      groupLabel: p.groupLabel,
    }))

    return {
      content: data.reply,
      products,
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

function fallbackToMock(
  userMessage: string
): { content: string; products?: ProductCard[] } {
  const mock = getMockResponse(userMessage)

  return {
    content: mock.content,
    products: mock.products,
  }
}
