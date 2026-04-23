/**
 * Build the embedding text for a product, enforcing a token budget.
 *
 * Strategy:
 *   1. Build "structured" text (name + variants + categories + brand + specs + tags + price)
 *      — these are always full, they're short + high signal
 *   2. Compute remaining budget = HARD - structured_tokens
 *   3. Truncate description to fit remaining budget at sentence boundary
 *   4. If structured alone exceeds HARD budget (rare, huge specs),
 *      drop lowest-signal fields progressively: tags → specs → categories[2+]
 *
 * Output format (one text blob):
 *   Product: ROCHITA (rochita)
 *   Variants: Rochita Roz, Rochita Alba
 *   Categories: Moda > Vestidos | Moda | Moda > Vestidos > Casual
 *   Brand: Nike
 *   <description text>
 *   Specs: Material: Bumbac, Color: Rosu
 *   Tags: Summer Collection, New Arrival
 *   Price: 189.99 RON
 */

import type { VTEXProduct, VTEXSku } from './types.ts'
import { countTokens, stripHtml, truncateToTokenBudget } from './token-budget.ts'

export interface BuildTextOptions {
  hardTokenBudget: number
  softTokenTarget: number
  currency?: string
}

export interface BuildTextResult {
  text: string
  tokens: number
  truncated: boolean
}

const GENERIC_BRAND_PATTERN = /^(test\s|brand\s|default|unknown)/i
const NOISE_TAG_PATTERN = /^(lengow|feed|export)$/i

export function buildProductEmbeddingText(
  product: VTEXProduct,
  options: BuildTextOptions
): BuildTextResult {
  const structured = buildStructuredParts(product, options.currency)
  const structuredText = structured.join('. ')
  const structuredTokens = countTokens(structuredText)

  // If structured already exceeds HARD budget, drop low-signal parts progressively
  if (structuredTokens > options.hardTokenBudget) {
    const trimmed = progressivelyDropFields(product, options)

    return {
      text: trimmed.text,
      tokens: trimmed.tokens,
      truncated: true,
    }
  }

  // Compute remaining budget for description
  const descriptionBudget = options.hardTokenBudget - structuredTokens

  // Get best description (longer of description vs metaTagDescription, HTML stripped)
  const description = pickBestDescription(product)
  let descriptionTokens = 0
  let finalDescription = ''
  let truncated = false

  if (description && descriptionBudget > 20) {
    if (countTokens(description) <= descriptionBudget) {
      finalDescription = description
      descriptionTokens = countTokens(description)
    } else {
      finalDescription = truncateToTokenBudget(description, descriptionBudget)
      descriptionTokens = countTokens(finalDescription)
      truncated = true
    }
  }

  const parts = [...structured]

  if (finalDescription) {
    // Insert description after structured header but before specs/tags/price
    // Find insertion point: after "Brand:" or "Categories:" or "Variants:" line
    const brandIdx = parts.findIndex((p) => p.startsWith('Brand:'))
    const insertAt = brandIdx >= 0 ? brandIdx + 1 : 2 // after Product line + next

    parts.splice(insertAt, 0, finalDescription)
  }

  const text = parts.join('. ')

  return {
    text,
    tokens: structuredTokens + descriptionTokens,
    truncated,
  }
}

// ─── Private helpers ───────────────────────────────────────────

function buildStructuredParts(product: VTEXProduct, currency = 'RON'): string[] {
  const parts: string[] = []

  // 1. Name + slug
  const nameParts = [`Product: ${product.productName}`]

  if (product.linkText && product.linkText.toLowerCase() !== product.productName.toLowerCase()) {
    nameParts.push(`(${product.linkText})`)
  }

  parts.push(nameParts.join(' '))

  // 2. SKU variant names
  const variantNames = extractVariantNames(product)

  if (variantNames.length > 0) {
    parts.push(`Variants: ${variantNames.slice(0, 10).join(', ')}`)
  }

  // 3. All category levels
  const cleanedCategories = (product.categories ?? [])
    .map((c) => c.replace(/\//g, ' > ').replace(/^ > | > $/g, '').trim())
    .filter(Boolean)

  if (cleanedCategories.length > 0) {
    parts.push(`Categories: ${cleanedCategories.join(' | ')}`)
  }

  // 4. Brand (skip generic placeholders)
  if (product.brand && !GENERIC_BRAND_PATTERN.test(product.brand)) {
    parts.push(`Brand: ${product.brand}`)
  }

  // 5. Structured specifications
  const specText = buildSpecsText(product)

  if (specText) parts.push(specText)

  // 6. Marketing/collection tags (skip noise)
  const tags = extractTags(product)

  if (tags.length > 0) parts.push(`Tags: ${tags.join(', ')}`)

  // 7. Price
  const price = extractPrice(product)

  if (price > 0) parts.push(`Price: ${price} ${currency}`)

  return parts
}

function extractVariantNames(product: VTEXProduct): string[] {
  const names = new Set<string>()

  for (const item of product.items ?? []) {
    const name = item.nameComplete || item.name

    if (name && name !== product.productName) {
      names.add(name)
    }
  }

  return [...names]
}

function buildSpecsText(product: VTEXProduct): string | null {
  const specs: string[] = []
  const allSpecs = product.allSpecifications ?? []

  for (const spec of allSpecs.slice(0, 15)) {
    const rawValue = product[spec]

    if (!rawValue) continue

    const value = Array.isArray(rawValue)
      ? rawValue.slice(0, 5).join(', ')
      : String(rawValue)

    const truncatedValue = value.length > 50 ? `${value.slice(0, 50)}…` : value

    specs.push(`${spec}: ${truncatedValue}`)
  }

  return specs.length > 0 ? `Specs: ${specs.join(', ')}` : null
}

function extractTags(product: VTEXProduct): string[] {
  if (!product.productClusters) return []

  return Object.values(product.productClusters).filter(
    (t): t is string => typeof t === 'string' && !NOISE_TAG_PATTERN.test(t)
  )
}

function extractPrice(product: VTEXProduct): number {
  const sku: VTEXSku | undefined = product.items?.[0]
  const seller = sku?.sellers?.[0]

  return seller?.commertialOffer?.Price ?? 0
}

function pickBestDescription(product: VTEXProduct): string {
  const descA = stripHtml(product.description ?? '')
  const descB = stripHtml(product.metaTagDescription ?? '')

  return descA.length >= descB.length ? descA : descB
}

/**
 * Fallback: structured text alone exceeds HARD budget.
 * Drop low-signal fields until we fit.
 */
function progressivelyDropFields(
  product: VTEXProduct,
  options: BuildTextOptions
): { text: string; tokens: number } {
  const attempts: Array<(p: VTEXProduct) => string[]> = [
    // Attempt 1: drop tags
    (p) => buildStructuredParts(p, options.currency).filter((x) => !x.startsWith('Tags:')),
    // Attempt 2: drop tags + specs
    (p) => buildStructuredParts(p, options.currency).filter((x) => !x.startsWith('Tags:') && !x.startsWith('Specs:')),
    // Attempt 3: keep only Product + Variants + first Category + Price
    (p) => {
      const parts = buildStructuredParts(p, options.currency)
      const out: string[] = []

      for (const part of parts) {
        if (
          part.startsWith('Product:') ||
          part.startsWith('Variants:') ||
          part.startsWith('Price:')
        ) {
          out.push(part)
        } else if (part.startsWith('Categories:')) {
          // Keep only first category level
          const first = part.replace('Categories: ', '').split(' | ')[0]

          out.push(`Categories: ${first}`)
        }
      }

      return out
    },
  ]

  for (const attempt of attempts) {
    const parts = attempt(product)
    const text = parts.join('. ')
    const tokens = countTokens(text)

    if (tokens <= options.hardTokenBudget) {
      return { text, tokens }
    }
  }

  // Last resort: just the product name
  const text = `Product: ${product.productName}`

  return { text, tokens: countTokens(text) }
}
