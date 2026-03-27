/**
 * Search Handlers
 *
 * Handle product search and detail requests.
 */

import { mapProduct, mapProductDetail } from '../mappers/product';

/**
 * GET /_v/acg/search
 * Search for products
 */
export async function searchProducts(ctx: Context) {
  const {
    query: { q, limit = '5', category, minPrice, maxPrice },
    clients: { search },
  } = ctx;

  if (!q) {
    ctx.status = 400;
    ctx.body = { error: 'Missing search query parameter "q"' };
    return;
  }

  try {
    console.log('[ACG Search] Request:', { q, limit, category, minPrice, maxPrice });

    const vtexProducts = await search.searchProducts(
      q as string,
      parseInt(limit as string, 10)
    );

    console.log('[ACG Search] VTEX Response:', JSON.stringify(vtexProducts, null, 2));

    // Map to simple format
    let products = vtexProducts.map(mapProduct);

    // Apply filters (if provided)
    if (category) {
      products = products.filter((p) =>
        p.category?.toLowerCase().includes((category as string).toLowerCase())
      );
    }

    if (minPrice) {
      const min = parseFloat(minPrice as string);
      products = products.filter((p) => p.price >= min);
    }

    if (maxPrice) {
      const max = parseFloat(maxPrice as string);
      products = products.filter((p) => p.price <= max);
    }

    const response = {
      products,
      total: products.length,
      query: q,
    };

    console.log('[ACG Search] Response:', JSON.stringify(response, null, 2));
    ctx.body = response;
  } catch (error) {
    console.error('Search error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to search products',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /_v/acg/product/:sku
 * Get product details by SKU
 */
export async function getProductDetail(ctx: Context) {
  const {
    params: { sku },
    clients: { search },
  } = ctx;

  if (!sku) {
    ctx.status = 400;
    ctx.body = { error: 'Missing SKU parameter' };
    return;
  }

  try {
    console.log('[ACG Product] Request SKU:', sku);

    const vtexProduct = await search.getProductBySku(sku);

    console.log('[ACG Product] VTEX Response:', JSON.stringify(vtexProduct, null, 2));

    if (!vtexProduct) {
      ctx.status = 404;
      ctx.body = { error: 'Product not found' };
      return;
    }

    const response = mapProductDetail(vtexProduct, sku);
    console.log('[ACG Product] Response:', JSON.stringify(response, null, 2));
    ctx.body = response;
  } catch (error) {
    console.error('Product detail error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to get product details',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
