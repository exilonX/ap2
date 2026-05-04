/**
 * Shared types for the sync-catalog script.
 *
 * VTEX types mirror the Catalog Search API response shape.
 * Internal types describe our sync state, errors, and embedding records.
 */

// ─── VTEX Catalog API types ────────────────────────────────────

export interface VTEXProduct {
  productId: string
  productName: string
  productTitle?: string
  brand: string
  brandId: number
  linkText: string
  productReference: string
  categoryId: string
  metaTagDescription?: string
  releaseDate?: string
  clusterHighlights?: Record<string, string>
  productClusters?: Record<string, string>
  searchableClusters?: Record<string, string>
  categories: string[]
  categoriesIds: string[]
  link: string
  description: string
  allSpecifications?: string[]
  allSpecificationsGroups?: string[]
  items: VTEXSku[]
  [key: string]: unknown // for dynamic spec fields
}

export interface VTEXSku {
  itemId: string
  name: string
  nameComplete?: string
  complementName?: string
  ean?: string
  referenceId?: Array<{ Key: string; Value: string }>
  images?: Array<{
    imageId: string
    imageLabel: string
    imageUrl: string
    imageText: string
  }>
  variations?: Array<{ name: string; values: string[] }>
  sellers?: Array<{
    sellerId: string
    sellerName: string
    commertialOffer?: {
      Price: number
      ListPrice: number
      AvailableQuantity: number
      IsAvailable?: boolean
    }
  }>
}

export interface GetProductAndSkuIdsResponse {
  data: Record<string, number[]> // productId → skuIds[]
  range: {
    total: number
    from: number
    to: number
  }
}

// ─── Pinecone types ─────────────────────────────────────────────

export interface PineconeVector {
  id: string
  values: number[]
  metadata?: Record<string, unknown>
}

export interface PineconeMatch {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

// ─── Internal sync types ────────────────────────────────────────

export interface ProductMetadata extends Record<string, unknown> {
  sku: string
  productId: string
  name: string
  linkText: string        // URL slug — product page is at /{linkText}/p
  price: number
  originalPrice: number   // catalog list price (> price when on sale)
  discountPct: number     // 0 if not on sale, else % off
  onSale: boolean         // true when originalPrice > price
  image: string
  category: string
  brand: string
  available: boolean
}

export type ErrorKind =
  | 'product_not_found' // 404 from VTEX — don't retry
  | 'vtex_fetch' // 5xx from VTEX — retry later
  | 'rate_limit' // 429 — should be retried with backoff
  | 'embedding' // OpenAI failure
  | 'pinecone' // Pinecone failure
  | 'token_budget' // Product text exceeds hard budget
  | 'network' // Network error
  | 'unknown' // Anything else

export interface ProductError {
  productId: number
  kind: ErrorKind
  reason: string
  attempts: number
  firstSeenAt: string
  lastSeenAt: string
  retryable: boolean
}

export interface SyncState {
  syncId: string
  startedAt: string
  lastUpdatedAt: string
  salesChannel: number

  // Discovery: all product IDs from GetProductAndSkuIds (may include inactive)
  // We don't know up-front which are active — we discover that during Phase 2
  // by checking if pub/products/search returns a body for each one.
  allProductIds: string[]

  // Progress
  processedProductIds: string[]    // successfully embedded + upserted
  inactiveProductIds: string[]     // returned [] from public search — skipped
  cursor: number                   // next index in allProductIds
  batchCount: number
}

// ─── Config ─────────────────────────────────────────────────────

export interface Config {
  vtex: {
    account: string
    workspace: string
    appKey: string
    appToken: string
    salesChannel: number
    locale: string                 // e.g. 'pt-BR', 'ro-RO', 'en-US'
  }
  openai: {
    apiKey: string
    model: string
    dimensions: number
  }
  pinecone: {
    apiKey: string
    indexHost: string
    namespace: string
  }
  sync: {
    concurrency: number
    batchSize: number
    hardTokenBudget: number
    softTokenTarget: number
    throttleMs: number
  }
}

// ─── CLI ────────────────────────────────────────────────────────

export interface CliArgs {
  mode: 'sync' | 'retry' | 'estimate' | 'fresh' | 'query'
  configPath?: string
  limit?: number
  concurrency?: number
  query?: string
  topK?: number
  onSaleOnly?: boolean
}

