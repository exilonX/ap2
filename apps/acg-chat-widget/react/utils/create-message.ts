import type { CartPreview, Mandate, Message, ProductCard } from '../types/domain'

/**
 * Canonical factory for `Message` objects.
 *
 * Generates a stable id (`Date.now()` + random suffix) and timestamps the
 * message at creation time. Used by both the live chat flow and the
 * dev-fallback path.
 */
export function createMessage(
  role: 'user' | 'assistant',
  content: string,
  products?: ProductCard[],
  suggestions?: string[],
  cartPreview?: CartPreview,
  mandate?: Mandate
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
