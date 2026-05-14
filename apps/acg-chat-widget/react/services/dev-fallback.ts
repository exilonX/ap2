/**
 * Dev-only chat fallback.
 *
 * Fires only when `fetch('/_v/acg/chat')` rejects at the transport
 * layer (no backend reachable, DNS failure, etc.) — typical when
 * running the widget against `vtex link` while the adapter is down.
 *
 * Returns a keyword-matched canned response so the developer can see
 * the UI behave without a working backend. Not used in production; an
 * HTTP error from a reachable backend goes through the real error path
 * (localized `errorConnection`) instead.
 */

import type { ProductCard } from '../types/domain'
import type { SendChatResult } from './chat-api'

const MOCK_PRODUCTS: ProductCard[] = [
  {
    productId: '1',
    name: 'Classic Running Shoes',
    imageUrl: 'https://via.placeholder.com/120x120.png?text=Shoes',
    price: 34999,
    listPrice: 44999,
    currency: 'RON',
    url: '#',
  },
  {
    productId: '2',
    name: 'Lightweight Trail Runner',
    imageUrl: 'https://via.placeholder.com/120x120.png?text=Trail',
    price: 29999,
    currency: 'RON',
    url: '#',
  },
]

interface CannedResponse {
  content: string
  products?: ProductCard[]
}

const KEYWORD_RESPONSES: Array<{
  keywords: string[]
  response: CannedResponse
}> = [
  {
    keywords: ['shoe', 'shoes', 'sneaker', 'running', 'pantofi', 'adidasi'],
    response: {
      content:
        'I found some great options for you! Here are our most popular running shoes:',
      products: MOCK_PRODUCTS,
    },
  },
  {
    keywords: ['cart', 'cos', 'add', 'buy', 'cumpara'],
    response: {
      content:
        "I've added the item to your cart! Would you like to continue shopping or proceed to checkout?",
    },
  },
  {
    keywords: ['checkout', 'pay', 'order', 'plata', 'comanda'],
    response: {
      content:
        "I'll redirect you to checkout now. Your cart total is 349.99 RON. The checkout is secured with AP2 cryptographic mandates.",
    },
  },
  {
    keywords: ['hello', 'hi', 'hey', 'salut', 'buna'],
    response: {
      content:
        "Hello! I'm your AI shopping assistant. I can help you find products, answer questions about items, or help you checkout. What are you looking for today?",
    },
  },
  {
    keywords: ['price', 'cost', 'pret', 'cheap', 'ieftin', 'discount'],
    response: {
      content:
        'We have great deals right now! Many items are up to 30% off. What type of product are you interested in? I can find the best prices for you.',
    },
  },
  {
    keywords: ['size', 'marime', 'fit'],
    response: {
      content:
        'For sizing, I recommend checking our size guide on the product page. Generally, our shoes run true to size. Would you like me to look up a specific product?',
    },
  },
  {
    keywords: ['return', 'retur', 'exchange', 'schimb'],
    response: {
      content:
        'We offer free returns within 30 days of purchase. Items must be unworn and in original packaging. Would you like me to help you start a return?',
    },
  },
]

const DEFAULT_RESPONSE: CannedResponse = {
  content:
    'I can help you find products, check prices, get size recommendations, or proceed to checkout. What would you like to do?',
}

function getMockResponse(userMessage: string): CannedResponse {
  const lower = userMessage.toLowerCase()

  for (const entry of KEYWORD_RESPONSES) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.response
    }
  }

  return DEFAULT_RESPONSE
}

export function fallbackToMock(userMessage: string): SendChatResult {
  const mock = getMockResponse(userMessage)

  return {
    content: mock.content,
    products: mock.products,
  }
}
