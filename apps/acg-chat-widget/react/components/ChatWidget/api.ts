import type { Message, ProductCard } from './types'
import { getMockResponse } from './mockResponses'

interface ChatAPIResponse {
  reply: string
  products?: Array<{
    productId: string
    name: string
    imageUrl: string
    price: number
    listPrice?: number
    currency: string
    url: string
  }>
  cartUpdated?: boolean
  error?: string
}

interface HistoryEntry {
  role: 'user' | 'assistant'
  content: string
}

function getBaseUrl(): string {
  return ''
}

function buildHistory(messages: Message[]): HistoryEntry[] {
  return messages
    .slice(-10)
    .map((m) => ({
      role: m.role,
      content: m.content,
    }))
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
): Promise<{ content: string; products?: ProductCard[]; cartUpdated?: boolean }> {
  const baseUrl = getBaseUrl()
  const orderFormId = getOrderFormIdFromCookie()

  try {
    const response = await fetch(`${baseUrl}/_v/acg/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        message: userMessage,
        history: buildHistory(conversationHistory),
        orderFormId,
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))

      console.error('[ACG Chat] API error:', response.status, errorData)

      return fallbackToMock(userMessage)
    }

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
      currency: p.currency,
      url: p.url,
    }))

    return {
      content: data.reply,
      products,
      cartUpdated: data.cartUpdated,
    }
  } catch (error) {
    console.error('[ACG Chat] Network error:', error)

    return fallbackToMock(userMessage)
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
