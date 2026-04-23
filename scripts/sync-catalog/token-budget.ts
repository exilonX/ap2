/**
 * Token counting + budget enforcement.
 *
 * Uses tiktoken (OpenAI's official tokenizer, cl100k_base encoding for text-embedding-3-*).
 * Falls back to a rough char-based estimate if tiktoken isn't available.
 */

import { get_encoding, type Tiktoken } from 'tiktoken'

let encoder: Tiktoken | null = null

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding('cl100k_base')
  }

  return encoder
}

/**
 * Count tokens for the given text using tiktoken.
 * Returns the exact count the OpenAI API will charge for.
 */
export function countTokens(text: string): number {
  if (!text) return 0

  try {
    return getEncoder().encode(text).length
  } catch {
    // Rough fallback: ~3.5 chars per token for multilingual content
    return Math.ceil(text.length / 3.5)
  }
}

/**
 * Truncate text to fit within a token budget.
 * Cuts at the last sentence boundary within the budget, or at a word boundary as fallback.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  if (!text) return ''

  const currentTokens = countTokens(text)

  if (currentTokens <= maxTokens) return text

  // Binary search: find the longest prefix that fits within the budget
  let lo = 0
  let hi = text.length

  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    const prefix = text.slice(0, mid)
    const tokens = countTokens(prefix)

    if (tokens <= maxTokens) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }

  const truncated = text.slice(0, lo)

  // Prefer cutting at a sentence boundary within the last 50% of the truncated text
  const minCutPoint = Math.floor(truncated.length * 0.5)
  const sentenceMarkers = ['. ', '! ', '? ', '.\n', '!\n', '?\n', '\n\n']

  let bestBoundary = -1

  for (const marker of sentenceMarkers) {
    const idx = truncated.lastIndexOf(marker)

    if (idx > minCutPoint && idx > bestBoundary) {
      bestBoundary = idx + marker.length
    }
  }

  if (bestBoundary > 0) {
    return truncated.slice(0, bestBoundary).trim()
  }

  // Fall back to last word boundary
  const lastSpace = truncated.lastIndexOf(' ')

  if (lastSpace > minCutPoint) {
    return `${truncated.slice(0, lastSpace).trim()}…`
  }

  return `${truncated.trim()}…`
}

/**
 * Strip HTML tags and normalize whitespace.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/**
 * Cleanup encoder (call on script exit to free WASM memory).
 */
export function freeEncoder(): void {
  if (encoder) {
    encoder.free()
    encoder = null
  }
}
