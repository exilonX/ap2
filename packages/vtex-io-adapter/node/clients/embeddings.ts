/**
 * OpenAI Embeddings Client
 *
 * Uses text-embedding-3-small for product catalog embeddings.
 * Cost: ~$0.02 per 1M tokens (~$0.001 for a 500-product catalog)
 */

import type { IOContext, InstanceOptions } from '@vtex/api'
import { ExternalClient } from '@vtex/api'

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 512 // Reduced from 1536 for cost/speed

interface EmbeddingResponse {
  data: Array<{
    embedding: number[]
    index: number
  }>
  usage: {
    prompt_tokens: number
    total_tokens: number
  }
}

export class EmbeddingsClient extends ExternalClient {
  constructor(
    context: IOContext,
    options: InstanceOptions & { apiKey: string }
  ) {
    super('https://api.openai.com', context, {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      timeout: 30000,
    })
  }

  /**
   * Embed a single text string
   */
  public async embed(text: string): Promise<number[]> {
    const response = await this.http.post<EmbeddingResponse>(
      '/v1/embeddings',
      {
        model: EMBEDDING_MODEL,
        input: text,
        dimensions: EMBEDDING_DIMENSIONS,
      },
      { metric: 'acg-embed-single' }
    )

    return response.data[0].embedding
  }

  /**
   * Embed multiple texts in a batch (max 2048 per request)
   */
  public async embedBatch(texts: string[]): Promise<number[][]> {
    const BATCH_SIZE = 100
    const allEmbeddings: number[][] = []

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      // Sequential by design — OpenAI embeddings has per-second rate
      // limits; parallel 100-batch fan-out trips them on large catalogs.
      // eslint-disable-next-line no-await-in-loop
      const response = await this.http.post<EmbeddingResponse>(
        '/v1/embeddings',
        {
          model: EMBEDDING_MODEL,
          input: batch,
          dimensions: EMBEDDING_DIMENSIONS,
        },
        { metric: 'acg-embed-batch' }
      )

      // Sort by index to maintain order
      const sorted = response.data.sort((a, b) => a.index - b.index)

      for (const item of sorted) {
        allEmbeddings.push(item.embedding)
      }
    }

    return allEmbeddings
  }
}

/**
 * Build the text to embed for a product.
 *
 * Strategy: combine everything a shopper might search for into one text blob.
 * The embedding model turns the entire blob into a single 512-dim vector
 * where similar concepts (synonyms, translations, related items) cluster together.
 *
 * Fields in order of signal strength:
 *   1. Product name + slug            — strongest match for literal searches
 *   2. SKU variant names              — contains color/size/style info
 *   3. Category path (all levels)     — context about what the product is
 *   4. Brand                          — brand-specific searches
 *   5. Description / metaDescription  — free-form details
 *   6. Specifications                 — structured attributes (material, season, etc.)
 *   7. Promo clusters / tags          — season, collection, campaign context
 *   8. Price                          — enables "cheap"/"expensive" queries
 */
export function buildProductEmbeddingText(product: {
  name: string
  linkText?: string // URL slug, cleaner than name
  variantNames?: string[] // SKU variant names (e.g. "Rochita Roz")
  categories?: string[] // All category paths
  brand?: string
  description?: string
  metaTagDescription?: string
  specifications?: Record<string, string>
  clusterTags?: string[] // Marketing/collection tags
  price?: number
  currency?: string
}): string {
  const parts: string[] = []

  // 1. Name + slug (the slug often has useful normalized keywords)
  parts.push(`Product: ${product.name}`)
  if (
    product.linkText &&
    product.linkText.toLowerCase() !== product.name.toLowerCase()
  ) {
    parts.push(`(${product.linkText})`)
  }

  // 2. Variant names — these often contain color, size, style info missing from product name
  if (product.variantNames && product.variantNames.length > 0) {
    const unique = [
      ...new Set(product.variantNames.filter((n) => n && n !== product.name)),
    ]

    if (unique.length > 0) {
      parts.push(`Variants: ${unique.slice(0, 10).join(', ')}`)
    }
  }

  // 3. All category levels — even if primary is wrong, subcategory might be right
  if (product.categories && product.categories.length > 0) {
    const cleaned = product.categories
      .map((c) =>
        c
          .replace(/\//g, ' > ')
          .replace(/^ > | > $/g, '')
          .trim()
      )
      .filter(Boolean)

    if (cleaned.length > 0) {
      parts.push(`Categories: ${cleaned.join(' | ')}`)
    }
  }

  // 4. Brand (skip if generic placeholder)
  if (product.brand && !/^test\s|^brand\s|^default/i.test(product.brand)) {
    parts.push(`Brand: ${product.brand}`)
  }

  // 5. Description — prefer the longer of description vs metaTagDescription
  const descA = (product.description || '').replace(/<[^>]*>/g, '').trim()
  const descB = (product.metaTagDescription || '')
    .replace(/<[^>]*>/g, '')
    .trim()

  const bestDesc = descA.length >= descB.length ? descA : descB

  if (bestDesc) {
    const truncated =
      bestDesc.length > 500 ? `${bestDesc.slice(0, 500)}...` : bestDesc

    parts.push(truncated)
  }

  // 6. Structured specifications — high signal when filled
  if (product.specifications) {
    const specs = Object.entries(product.specifications)
      .slice(0, 15)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')

    if (specs) {
      parts.push(`Specs: ${specs}`)
    }
  }

  // 7. Marketing/collection tags — e.g. "Summer 2026", "New Arrivals"
  if (product.clusterTags && product.clusterTags.length > 0) {
    const tags = product.clusterTags.filter((t) => t && !/^lengow$/i.test(t))

    if (tags.length > 0) {
      parts.push(`Tags: ${tags.join(', ')}`)
    }
  }

  if (product.price && product.currency) {
    parts.push(`Price: ${product.price} ${product.currency}`)
  }

  return parts.join('. ')
}
