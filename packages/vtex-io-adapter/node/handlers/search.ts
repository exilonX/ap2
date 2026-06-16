/* eslint-disable no-console -- pre-existing instrumentation; tracked by issue 0005 (Logger injection) */
/**
 * Search Handlers
 *
 * Handle product search and detail requests.
 */

import type { PineconeMatch } from '../clients/pinecone'
import { mapProduct, mapProductDetail } from '../mappers/product'
import type { SimpleProduct } from '../types/shared'
import { semanticSearch } from './rag'

// Cache store currency to avoid repeated orderForm creation
let cachedCurrency: string | null = null

/**
 * Map a Pinecone match (carrying sync-catalog-emitted metadata) to a
 * SimpleProduct. Mirrors `mapProduct`'s output shape so the response is
 * identical regardless of whether semantic or legacy search served the result.
 *
 * Falls back gracefully on missing fields — the chat handler's hydration step
 * downstream (when the agent does `get_product_details` for a specific SKU)
 * will refresh anything stale.
 */
export function pineconeMatchToProduct(match: PineconeMatch): SimpleProduct {
  const meta = match.metadata ?? {}
  const sku = String(meta.sku ?? match.id)
  const price = Number(meta.price ?? 0)
  const originalPrice = Number(meta.originalPrice ?? 0)
  const rawCategory = String(meta.category ?? '')
  const category = rawCategory
    ? rawCategory
        .replace(/\//g, ' > ')
        .replace(/^ > | > $/g, '')
        .trim()
    : undefined

  return {
    sku,
    name: String(meta.name ?? 'Unknown'),
    price,
    originalPrice: originalPrice > price ? originalPrice : undefined,
    image: meta.image ? String(meta.image) : undefined,
    available: meta.available !== false,
    category,
    brand: meta.brand ? String(meta.brand) : undefined,
  }
}

/**
 * GET /_v/acg/search
 * Search for products
 *
 * Two-tier strategy:
 *   1. Semantic search via Pinecone (semanticSearch in handlers/rag.ts) —
 *      matches the chat handler's behavior so queries like "rochie" /
 *      "dress" / "rochiță damă" find products even when their literal
 *      tokens aren't in the catalog text.
 *   2. Falls back to VTEX legacy `/catalog_system/pub/products/search/{q}`
 *      when Pinecone is unconfigured, errored, or returned no hits.
 *
 * Both paths feed the same filters + qualifier-conflict pass before
 * responding, so the output shape is identical regardless of source.
 */
export async function searchProducts(ctx: Context) {
  const {
    query: { q, limit = '5', category, minPrice, maxPrice },
    clients: { search },
  } = ctx

  if (!q) {
    ctx.status = 400
    ctx.body = { error: 'Missing search query parameter "q"' }

    return
  }

  const parsedLimit = parseInt(limit as string, 10)

  try {
    console.log('[ACG Search] Request:', {
      q,
      limit,
      category,
      minPrice,
      maxPrice,
    })

    let products: SimpleProduct[] = []
    let source: 'semantic' | 'legacy' = 'semantic'

    // Tier 1: semantic search via Pinecone.
    const ragResult = await semanticSearch(ctx, q as string, parsedLimit, {
      available: true,
    })

    if (!ragResult.fallback && ragResult.results.length > 0) {
      products = ragResult.results.map(pineconeMatchToProduct)
      console.log(
        '[ACG Search] Pinecone Response:',
        `${products.length} products found (top score ${(
          (ragResult.results[0]?.score ?? 0) * 100
        ).toFixed(0)}%)`
      )
    } else {
      // Tier 2: legacy VTEX catalog search.
      source = 'legacy'
      const vtexProducts = await search.searchProducts(q as string, parsedLimit)

      console.log(
        '[ACG Search] VTEX Response:',
        `${vtexProducts.length} products found (semantic ${
          ragResult.fallback ? 'unavailable' : 'returned 0'
        })`
      )
      products = vtexProducts.map(mapProduct)
    }

    // Apply filters (if provided)
    if (category) {
      products = products.filter((p) =>
        p.category?.toLowerCase().includes((category as string).toLowerCase())
      )
    }

    if (minPrice) {
      const min = parseFloat(minPrice as string)

      products = products.filter((p) => p.price >= min)
    }

    if (maxPrice) {
      const max = parseFloat(maxPrice as string)

      products = products.filter((p) => p.price <= max)
    }

    // Qualifier-conflict filter (issue 0009 mitigation). The semantic
    // engine ranks size/length qualifiers weakly, so "pantaloni lungi"
    // often returns "Pantaloni Scurți" mixed in. If the query asserts a
    // positive qualifier without its negative counterpart, drop products
    // whose name/category contains the negative form.
    //
    // Add new pairs here as they surface during testing — keep the
    // regexes tight (\b boundaries + diacritic variants) to avoid
    // false-positives on adjacent words.
    const queryStr = (q as string).toLowerCase()
    const QUALIFIER_PAIRS: Array<{ positive: RegExp; negative: RegExp }> = [
      // Long vs short pants
      { positive: /\blung[iăa]?\b/i, negative: /\bscurt[iăaț]?\b/i },
    ]

    for (const pair of QUALIFIER_PAIRS) {
      if (pair.positive.test(queryStr) && !pair.negative.test(queryStr)) {
        products = products.filter((p) => {
          const haystack = `${p.name ?? ''} ${p.category ?? ''}`

          return !pair.negative.test(haystack)
        })
      }
    }

    // Get store currency (cached after first call)
    if (!cachedCurrency) {
      try {
        const orderForm = await ctx.clients.checkout.createOrderForm()

        cachedCurrency = orderForm.storePreferencesData?.currencyCode || 'EUR'
      } catch {
        cachedCurrency = 'EUR'
      }
    }

    const currency = cachedCurrency

    const response = {
      products,
      total: products.length,
      query: q,
      currency,
      source,
    }

    console.log(
      '[ACG Search] Response:',
      `${response.products?.length ?? 0} products via ${source}, currency: ${
        response.currency ?? 'unknown'
      }`
    )
    ctx.body = response
  } catch (error) {
    console.error('Search error:', error)
    ctx.status = 500
    ctx.body = {
      error: 'Failed to search products',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * GET /_v/acg/product/:sku
 * Get product details by SKU
 */
export async function getProductDetail(ctx: Context) {
  const { search } = ctx.clients
  const sku = ctx.vtex.route?.params?.sku ?? ctx.params?.sku

  if (!sku) {
    ctx.status = 400
    ctx.body = { error: 'Missing SKU parameter' }

    return
  }

  try {
    console.log('[ACG Product] Request SKU:', sku)

    const vtexProduct = await search.getProductBySku(sku)

    console.log(
      '[ACG Product] VTEX Response:',
      `product ${vtexProduct?.productId ?? 'null'}`
    )

    if (!vtexProduct) {
      ctx.status = 404
      ctx.body = { error: 'Product not found' }

      return
    }

    const response = mapProductDetail(vtexProduct, sku)

    console.log(
      '[ACG Product] Response:',
      `sku: ${response.sku}, price: ${response.price}`
    )
    ctx.body = response
  } catch (error) {
    console.error('Product detail error:', error)
    ctx.status = 500
    ctx.body = {
      error: 'Failed to get product details',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
