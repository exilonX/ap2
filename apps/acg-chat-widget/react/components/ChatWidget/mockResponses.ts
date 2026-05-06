import type { Message, ProductCard } from './types'

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

interface MockResponse {
  content: string
  products?: ProductCard[]
  delay: number
}

const KEYWORD_RESPONSES: Array<{
  keywords: string[]
  response: MockResponse
}> = [
  {
    keywords: ['shoe', 'shoes', 'sneaker', 'running', 'pantofi', 'adidasi'],
    response: {
      content:
        'I found some great options for you! Here are our most popular running shoes:',
      products: MOCK_PRODUCTS,
      delay: 1200,
    },
  },
  {
    keywords: ['cart', 'cos', 'add', 'buy', 'cumpara'],
    response: {
      content:
        "I've added the item to your cart! Would you like to continue shopping or proceed to checkout?",
      delay: 800,
    },
  },
  {
    keywords: ['checkout', 'pay', 'order', 'plata', 'comanda'],
    response: {
      content:
        "I'll redirect you to checkout now. Your cart total is 349.99 RON. The checkout is secured with AP2 cryptographic mandates.",
      delay: 1000,
    },
  },
  {
    keywords: ['hello', 'hi', 'hey', 'salut', 'buna'],
    response: {
      content:
        "Hello! I'm your AI shopping assistant. I can help you find products, answer questions about items, or help you checkout. What are you looking for today?",
      delay: 600,
    },
  },
  {
    keywords: ['price', 'cost', 'pret', 'cheap', 'ieftin', 'discount'],
    response: {
      content:
        'We have great deals right now! Many items are up to 30% off. What type of product are you interested in? I can find the best prices for you.',
      delay: 900,
    },
  },
  {
    keywords: ['size', 'marime', 'fit'],
    response: {
      content:
        'For sizing, I recommend checking our size guide on the product page. Generally, our shoes run true to size. Would you like me to look up a specific product?',
      delay: 800,
    },
  },
  {
    keywords: ['return', 'retur', 'exchange', 'schimb'],
    response: {
      content:
        'We offer free returns within 30 days of purchase. Items must be unworn and in original packaging. Would you like me to help you start a return?',
      delay: 700,
    },
  },
]

const DEFAULT_RESPONSE: MockResponse = {
  content:
    "I can help you find products, check prices, get size recommendations, or proceed to checkout. What would you like to do?",
  delay: 1000,
}

export function getMockResponse(userMessage: string): MockResponse {
  const lower = userMessage.toLowerCase()

  for (const entry of KEYWORD_RESPONSES) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.response
    }
  }

  return DEFAULT_RESPONSE
}

export function createMessage(
  role: 'user' | 'assistant',
  content: string,
  products?: ProductCard[],
  suggestions?: string[],
  cartPreview?: import('./types').CartPreview,
  mandate?: import('./types').Mandate
): Message {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    timestamp: Date.now(),
    products,
    suggestions,
    cartPreview,
    mandate,
  }
}
