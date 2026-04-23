/**
 * RAG Handlers
 *
 * - POST /_v/acg/rag/sync     — Embed entire catalog into Pinecone
 * - GET  /_v/acg/rag/status    — Check sync status
 * - POST /_v/acg/rag/search    — Semantic search (used by chat handler)
 */

import { json } from 'co-body'

import { EmbeddingsClient, buildProductEmbeddingText } from '../clients/embeddings'
import { PineconeClient } from '../clients/pinecone'
import type { PineconeVector, PineconeMatch } from '../clients/pinecone'
import { mapProductDetail } from '../mappers/product'
import type { VTEXProduct } from '../clients/search'

// ─── Types ─────────────────────────────────────────────────────

interface RagSettings {
  openaiApiKey?: string
  pineconeApiKey?: string
  pineconeIndexHost?: string
}

interface SyncStatus {
  lastSyncAt: string
  productCount: number
  status: 'idle' | 'syncing' | 'done' | 'error'
  error?: string
}

const VBASE_BUCKET = 'acg-rag'
const SYNC_STATUS_KEY = 'sync-status'

// ─── Helpers ───────────────────────────────────────────────────

function getSettings(ctx: Context): RagSettings {
  // Settings come from the same app settings as LLM config
  return ctx.vtex.settings || {}
}

async function getAppSettings(ctx: Context): Promise<RagSettings> {
  return ctx.clients.apps
    .getAppSettings('vtexeurope.acg-adapter')
    .catch(() => ({}))
}

function createEmbeddingsClient(ctx: Context, settings: RagSettings): EmbeddingsClient {
  if (!settings.openaiApiKey) {
    throw new Error('OpenAI API key not configured. Required for embeddings.')
  }

  return new EmbeddingsClient(ctx.vtex, { apiKey: settings.openaiApiKey })
}

function createPineconeClient(ctx: Context, settings: RagSettings): PineconeClient {
  if (!settings.pineconeApiKey || !settings.pineconeIndexHost) {
    throw new Error('Pinecone API key and index host not configured.')
  }

  return new PineconeClient(ctx.vtex, {
    indexHost: settings.pineconeIndexHost,
    apiKey: settings.pineconeApiKey,
  })
}

/**
 * Fetch all products from VTEX catalog (paginated)
 */
async function fetchAllProducts(ctx: Context): Promise<VTEXProduct[]> {
  const allProducts: VTEXProduct[] = []
  const PAGE_SIZE = 50
  let from = 0
  let hasMore = true

  while (hasMore) {
    try {
      const products = await ctx.clients.search.http.get<VTEXProduct[]>(
        `/api/catalog_system/pub/products/search`,
        {
          params: {
            _from: from,
            _to: from + PAGE_SIZE - 1,
          },
          metric: 'acg-rag-fetch-all',
        }
      )

      allProducts.push(...products)
      from += PAGE_SIZE

      // VTEX returns empty array when no more products
      if (products.length < PAGE_SIZE) {
        hasMore = false
      }

      // Safety: max 2000 products
      if (allProducts.length >= 2000) {
        hasMore = false
      }
    } catch {
      hasMore = false
    }
  }

  return allProducts
}

// ─── Sync Handler ──────────────────────────────────────────────

export async function syncCatalog(ctx: Context) {
  try {
    const settings = await getAppSettings(ctx)

    let embeddings: EmbeddingsClient
    let pinecone: PineconeClient

    try {
      embeddings = createEmbeddingsClient(ctx, settings)
      pinecone = createPineconeClient(ctx, settings)
    } catch (error) {
      ctx.status = 500
      ctx.body = { error: error instanceof Error ? error.message : 'Missing RAG configuration' }

      return
    }

    // Update status
    const status: SyncStatus = {
      lastSyncAt: new Date().toISOString(),
      productCount: 0,
      status: 'syncing',
    }

    await ctx.clients.vbase.saveJSON(VBASE_BUCKET, SYNC_STATUS_KEY, status)

    console.log('[ACG RAG] Starting catalog sync...')

    // 1. Fetch all products from VTEX
    const vtexProducts = await fetchAllProducts(ctx)

    console.log(`[ACG RAG] Fetched ${vtexProducts.length} products from catalog`)

    if (vtexProducts.length === 0) {
      status.status = 'done'
      status.productCount = 0
      await ctx.clients.vbase.saveJSON(VBASE_BUCKET, SYNC_STATUS_KEY, status)
      ctx.body = { message: 'No products found in catalog', count: 0 }

      return
    }

    // 2. Build embedding texts
    const productTexts: string[] = []
    const productMetadata: Array<Record<string, unknown>> = []

    for (const vp of vtexProducts) {
      const detail = mapProductDetail(vp)

      // Pull extra fields directly from the raw VTEX product for richer embedding
      const variantNames = vp.items?.map((i) => i.nameComplete || i.name).filter(Boolean) || []
      const clusterTags = vp.productClusters
        ? Object.values(vp.productClusters).filter((v): v is string => typeof v === 'string')
        : []

      const text = buildProductEmbeddingText({
        name: detail.name,
        linkText: vp.linkText,
        variantNames,
        categories: vp.categories,
        brand: detail.brand,
        description: detail.description,
        metaTagDescription: vp.metaTagDescription,
        specifications: detail.specifications,
        clusterTags,
        price: detail.price,
        currency: 'RON', // TODO: derive from store
      })

      productTexts.push(text)
      productMetadata.push({
        sku: detail.sku,
        name: detail.name,
        price: detail.price,
        originalPrice: detail.originalPrice || 0,
        image: detail.image || '',
        category: detail.category || '',
        brand: detail.brand || '',
        available: detail.available,
      })
    }

    // 3. Embed all products
    console.log(`[ACG RAG] Embedding ${productTexts.length} products...`)
    const vectors = await embeddings.embedBatch(productTexts)

    // 4. Build Pinecone vectors
    const pineconeVectors: PineconeVector[] = vectors.map((values, i) => ({
      id: `product-${productMetadata[i].sku}`,
      values,
      metadata: productMetadata[i],
    }))

    // 5. Clear old data and upsert
    console.log('[ACG RAG] Upserting to Pinecone...')
    await pinecone.deleteAll()
    const upsertedCount = await pinecone.upsert(pineconeVectors)

    // 6. Update status
    status.status = 'done'
    status.productCount = upsertedCount
    await ctx.clients.vbase.saveJSON(VBASE_BUCKET, SYNC_STATUS_KEY, status)

    console.log(`[ACG RAG] Sync complete: ${upsertedCount} products embedded`)

    ctx.body = {
      message: `Catalog synced successfully`,
      count: upsertedCount,
      syncedAt: status.lastSyncAt,
    }
  } catch (error) {
    console.error('[ACG RAG] Sync error:', error)

    try {
      const errorStatus: SyncStatus = {
        lastSyncAt: new Date().toISOString(),
        productCount: 0,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      }

      await ctx.clients.vbase.saveJSON(VBASE_BUCKET, SYNC_STATUS_KEY, errorStatus)
    } catch {
      // VBase might also fail
    }

    ctx.status = 500
    ctx.body = {
      error: 'Catalog sync failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ─── Status Handler ────────────────────────────────────────────

export async function getSyncStatus(ctx: Context) {
  try {
    const status = await ctx.clients.vbase.getJSON<SyncStatus>(
      VBASE_BUCKET,
      SYNC_STATUS_KEY
    )

    ctx.body = status
  } catch {
    ctx.body = {
      status: 'idle',
      productCount: 0,
      lastSyncAt: null,
      message: 'Catalog has not been synced yet. POST to /_v/acg/rag/sync to start.',
    }
  }
}

// ─── Semantic Search Function (used by chat handler) ───────────

export async function semanticSearch(
  ctx: Context,
  query: string,
  topK: number = 5,
  filter?: Record<string, unknown>
): Promise<{
  results: PineconeMatch[]
  fallback: boolean
}> {
  try {
    const settings = await getAppSettings(ctx)
    const embeddings = createEmbeddingsClient(ctx, settings)
    const pinecone = createPineconeClient(ctx, settings)

    // Embed the search query
    const queryVector = await embeddings.embed(query)

    // Search Pinecone
    const matches = await pinecone.query(queryVector, topK, filter)

    // Filter out low-confidence matches
    const goodMatches = matches.filter((m) => m.score >= 0.3)

    if (goodMatches.length === 0) {
      return { results: [], fallback: true }
    }

    return { results: goodMatches, fallback: false }
  } catch (error) {
    console.error('[ACG RAG] Semantic search error:', error)

    // Fall back to keyword search
    return { results: [], fallback: true }
  }
}
