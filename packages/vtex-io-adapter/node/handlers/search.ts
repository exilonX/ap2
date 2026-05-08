/* eslint-disable no-console -- pre-existing instrumentation; tracked by issue 0005 (Logger injection) */
/**
 * Search Handlers
 *
 * Handle product search and detail requests.
 */

import { mapProduct, mapProductDetail } from '../mappers/product'

// Cache store currency to avoid repeated orderForm creation
let cachedCurrency: string | null = null

/**
 * GET /_v/acg/search
 * Search for products
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

  try {
    console.log('[ACG Search] Request:', {
      q,
      limit,
      category,
      minPrice,
      maxPrice,
    })

    const vtexProducts = await search.searchProducts(
      q as string,
      parseInt(limit as string, 10)
    )

    console.log(
      '[ACG Search] VTEX Response:',
      `${vtexProducts.length} products found`
    )

    // Map to simple format
    let products = vtexProducts.map(mapProduct)

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
    }

    console.log(
      '[ACG Search] Response:',
      `${response.products?.length ?? 0} products, currency: ${
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
