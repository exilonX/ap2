/**
 * Main sync orchestration using VTEX Intelligent Search for discovery.
 *
 * Phase 1 — Discovery:
 *   Intelligent Search returns only ACTIVE products (already filtered).
 *   - If total < 2500: flat pagination (fast)
 *   - If total > 2500: walk by category (each category < 2500)
 *
 * Phase 2 — Embed + Upsert (streaming):
 *   Process products in batches as they arrive:
 *     a. Accumulate BATCH_SIZE products
 *     b. Build embedding texts (token-budgeted)
 *     c. Batch embed via OpenAI
 *     d. Batch upsert to Pinecone
 *     e. Atomic state save
 */

import type {
  Config,
  PineconeVector,
  ProductMetadata,
  SyncState,
  VTEXProduct,
} from './types.ts'
import {
  IntelligentSearchClient,
  type IntelligentSearchProduct,
} from './clients/intelligent-search.ts'
import { OpenAIClient } from './clients/openai.ts'
import { PineconeClient } from './clients/pinecone.ts'
import { buildProductEmbeddingText } from './embedding-text.ts'
import { ErrorQueue } from './error-queue.ts'
import { Logger } from './logger.ts'
import { Progress } from './progress.ts'
import {
  applyBatchOutcome,
  clearState,
  isDone,
  loadState,
  newState,
  remainingProductIds,
  saveState,
  type BatchOutcome,
} from './state.ts'
import { chunk, sleep } from './utils.ts'
import { freeEncoder } from './token-budget.ts'

export interface SyncOptions {
  fresh?: boolean
  limit?: number
}

const EMBED_BATCH_SIZE = 100 // max products per embed+upsert batch

// ─── Discovery: stream all active products from Intelligent Search ─

async function discoverActiveProducts(
  search: IntelligentSearchClient,
  account: string,
  options: { limit?: number; hideUnavailable?: boolean } = {}
): Promise<{
  products: IntelligentSearchProduct[]
  hitCap: boolean
  walkedCategories: boolean
}> {
  console.log('Phase 1 — Discovering active products via Intelligent Search...')

  const collected: IntelligentSearchProduct[] = []
  const seenIds = new Set<string>()
  let hitCap = false
  let walkedCategories = false

  // First try flat pagination — fastest if catalog < 2500
  for await (const page of search.streamAllProducts({
    pageSize: 50,
    hideUnavailable: options.hideUnavailable,
  })) {
    for (const p of page.products) {
      if (!seenIds.has(p.productId)) {
        seenIds.add(p.productId)
        collected.push(p)
        if (options.limit && collected.length >= options.limit) break
      }
    }

    process.stdout.write(
      `\r  Page ${page.page + 1} — collected ${collected.length.toLocaleString()} / ${page.recordsFiltered.toLocaleString()} active products`
    )

    if (options.limit && collected.length >= options.limit) break

    if (page.hitCap) {
      hitCap = true
      break
    }
  }
  process.stdout.write('\n')

  // If hit the 2500 cap, fall back to category walk
  if (hitCap && (!options.limit || collected.length < options.limit)) {
    walkedCategories = true
    console.log(`  Hit 2500-record cap → walking by category for completeness...`)

    for await (const page of search.streamByCategoryWalk(account, {
      pageSize: 50,
      hideUnavailable: options.hideUnavailable,
    })) {
      for (const p of page.products) {
        if (!seenIds.has(p.productId)) {
          seenIds.add(p.productId)
          collected.push(p)
          if (options.limit && collected.length >= options.limit) break
        }
      }

      process.stdout.write(
        `\r  Cat ${page.categoryIndex + 1}/${page.totalCategories} "${page.categoryName}" page ${page.page} — ${collected.length.toLocaleString()} unique products`.padEnd(100, ' ')
      )

      if (options.limit && collected.length >= options.limit) break
    }
    process.stdout.write('\n')
  }

  return { products: collected, hitCap, walkedCategories }
}

// ─── Main sync ─────────────────────────────────────────────────

export async function runSync(config: Config, options: SyncOptions = {}): Promise<void> {
  const logger = new Logger()
  const progress = new Progress()
  const errorQueue = new ErrorQueue()

  const search = new IntelligentSearchClient(config.vtex.account, config.vtex.locale)
  const openai = new OpenAIClient(config.openai)
  const pinecone = new PineconeClient(config.pinecone)

  // In-memory cache of products discovered during Phase 1, keyed by productId.
  // This avoids re-fetching if we have the data already.
  const productCache = new Map<string, IntelligentSearchProduct>()

  try {
    await errorQueue.load()

    let state: SyncState | null = null

    if (options.fresh) {
      console.log('Fresh run — clearing state and Pinecone namespace...')
      await clearState()
      await pinecone.deleteAll()
      errorQueue.clear()
    } else {
      state = await loadState()
    }

    if (state && !isDone(state)) {
      console.log(`Resuming sync ${state.syncId}`)
      console.log(
        `  Progress: ${state.processedProductIds.length} processed · ${state.cursor} / ${state.allProductIds.length}`
      )
      console.log(
        `  ⚠ Resuming requires re-discovering products from Intelligent Search (not cached across runs).`
      )
    }

    // Discovery always runs (Intelligent Search doesn't have a cursor we can persist)
    const discovery = await discoverActiveProducts(search, config.vtex.account, {
      limit: options.limit,
      hideUnavailable: false,
    })

    for (const p of discovery.products) {
      productCache.set(p.productId, p)
    }

    console.log(
      `  Discovered ${discovery.products.length.toLocaleString()} unique active products${
        discovery.walkedCategories ? ' (via category walk)' : ''
      }`
    )
    console.log()

    // Initialize or reconcile state
    const allProductIds = discovery.products.map((p) => p.productId)

    if (!state || isDone(state)) {
      state = newState(allProductIds, config.vtex.salesChannel)
    } else {
      // Reconcile: keep progress, but swap in the new list if it differs
      const processedSet = new Set(state.processedProductIds)

      state = {
        ...state,
        allProductIds,
        cursor: allProductIds.findIndex((id) => !processedSet.has(id)),
      }
      if (state.cursor === -1) state.cursor = allProductIds.length
    }

    await saveState(state)
    await logger.init(state.syncId)
    logger.info('sync_state_loaded', {
      syncId: state.syncId,
      total: state.allProductIds.length,
      processed: state.processedProductIds.length,
    })

    // ─── Phase 2: Embed + upsert in batches ────────────────────
    const pending = remainingProductIds(state)

    console.log(
      `Phase 2 — Embedding + upserting ${pending.length.toLocaleString()} products (batch size ${EMBED_BATCH_SIZE})...`
    )
    console.log()

    progress.start(state.allProductIds.length)
    progress.update({
      processed: state.cursor,
      errors: errorQueue.size,
    })

    const batches = chunk(pending, EMBED_BATCH_SIZE)

    for (const [batchIdx, productBatch] of batches.entries()) {
      const batchStart = Date.now()

      const outcome = await processBatch(productBatch, productCache, {
        openai,
        pinecone,
        config,
        errorQueue,
        logger,
      })

      state = applyBatchOutcome(state, productBatch.length, outcome)

      await saveState(state)
      await errorQueue.save()

      const batchDurationMs = Date.now() - batchStart

      progress.update({
        processed: state.cursor,
        errors: errorQueue.size,
        batchDurationMs,
      })

      logger.info('batch_done', {
        batchIdx,
        batchSize: productBatch.length,
        processed: outcome.processed.length,
        inactive: outcome.inactive.length,
        errors: outcome.errorCount,
        durationMs: batchDurationMs,
      })

      if (batchIdx < batches.length - 1) {
        await sleep(config.sync.throttleMs)
      }
    }

    progress.finish()

    console.log()
    console.log('═══════════════════════════════════════════════════════════')
    console.log('  Sync Complete')
    console.log('═══════════════════════════════════════════════════════════')
    console.log(`  Active products:   ${state.allProductIds.length.toLocaleString()}`)
    console.log(`  Embedded:          ${state.processedProductIds.length.toLocaleString()}`)
    console.log(`  Errors:            ${errorQueue.size}`)
    console.log(`  Sync ID:           ${state.syncId}`)
    console.log(`  Logs:              ${logger.getLogPath()}`)
    if (errorQueue.size > 0) {
      console.log()
      console.log(`  Retry failed products with: tsx index.ts --retry`)
    }
    console.log('═══════════════════════════════════════════════════════════')

    logger.info('sync_complete', {
      total: state.allProductIds.length,
      processed: state.processedProductIds.length,
      errors: errorQueue.size,
    })
  } finally {
    await logger.close()
    freeEncoder()
  }
}

// ─── Retry mode ────────────────────────────────────────────────

export async function runRetry(config: Config): Promise<void> {
  const logger = new Logger()
  const errorQueue = new ErrorQueue()

  try {
    await errorQueue.load()
    const retryable = errorQueue.getRetryable()

    if (retryable.length === 0) {
      console.log('No retryable errors in queue.')

      return
    }

    console.log(`Retry mode: ${retryable.length} failed products`)
    console.log(`  Note: re-discovery from Intelligent Search is required.`)
    console.log(`  Just run a fresh sync — it will skip already-processed products via state.`)
  } finally {
    await logger.close()
  }
}

// ─── Batch processor ───────────────────────────────────────────

interface BatchDeps {
  openai: OpenAIClient
  pinecone: PineconeClient
  config: Config
  errorQueue: ErrorQueue
  logger: Logger
}

async function processBatch(
  productIds: string[],
  cache: Map<string, IntelligentSearchProduct>,
  deps: BatchDeps
): Promise<BatchOutcome> {
  // Phase A: Look up products in the cache (populated during discovery)
  const successful: Array<{ productId: string; product: VTEXProduct }> = []
  const missing: string[] = []

  for (const id of productIds) {
    const cached = cache.get(id)

    if (cached) {
      successful.push({ productId: id, product: cached as unknown as VTEXProduct })
    } else {
      missing.push(id)
    }
  }

  // If products are missing from cache, log them (shouldn't happen in current flow)
  if (missing.length > 0) {
    deps.logger.warn('missing_from_cache', { count: missing.length, first: missing[0] })
    for (const id of missing) {
      deps.errorQueue.add(Number(id), new Error('Product not in discovery cache'))
    }
  }

  if (successful.length === 0) {
    return { processed: [], inactive: [], errorCount: missing.length }
  }

  // Phase B: Build embedding text
  const embeddingInputs = successful.map(({ productId, product }) => {
    const result = buildProductEmbeddingText(product, {
      hardTokenBudget: deps.config.sync.hardTokenBudget,
      softTokenTarget: deps.config.sync.softTokenTarget,
    })

    return {
      productId,
      product,
      embeddingText: result.text,
      tokens: result.tokens,
      truncated: result.truncated,
    }
  })

  // Phase C: Batch embed via OpenAI
  let vectors: number[][] = []

  try {
    const embedResult = await deps.openai.embedBatch(embeddingInputs.map((e) => e.embeddingText))

    vectors = embedResult.vectors
    deps.logger.debug('embed_batch', {
      count: embeddingInputs.length,
      tokens: embedResult.totalTokens,
    })
  } catch (error) {
    for (const e of embeddingInputs) {
      deps.errorQueue.add(Number(e.productId), error)
    }
    deps.logger.error('embed_batch_failed', {
      count: embeddingInputs.length,
      reason: error instanceof Error ? error.message : String(error),
    })

    return { processed: [], inactive: [], errorCount: missing.length + embeddingInputs.length }
  }

  // Phase D: Upsert to Pinecone
  const pineconeVectors: PineconeVector[] = embeddingInputs.map((e, i) => ({
    id: `product-${e.product.productId}`,
    values: vectors[i],
    metadata: toProductMetadata(e.product),
  }))

  try {
    await deps.pinecone.upsert(pineconeVectors)
  } catch (error) {
    for (const e of embeddingInputs) {
      deps.errorQueue.add(Number(e.productId), error)
    }
    deps.logger.error('upsert_failed', {
      count: pineconeVectors.length,
      reason: error instanceof Error ? error.message : String(error),
    })

    return { processed: [], inactive: [], errorCount: missing.length + embeddingInputs.length }
  }

  const processed = successful.map((s) => s.productId)

  return { processed, inactive: [], errorCount: missing.length }
}

// ─── Metadata builder ──────────────────────────────────────────

function toProductMetadata(product: VTEXProduct): ProductMetadata {
  const sku = product.items?.[0]
  const seller = sku?.sellers?.[0]
  const offer = seller?.commertialOffer

  const price = offer?.Price ?? 0
  const listPrice = offer?.ListPrice ?? 0
  const onSale = listPrice > price && price > 0
  const discountPct = onSale ? Math.round(((listPrice - price) / listPrice) * 100) : 0

  return {
    sku: sku?.itemId ?? product.productId,
    productId: String(product.productId),
    name: product.productName,
    linkText: product.linkText ?? '',
    price,
    originalPrice: listPrice,
    discountPct,
    onSale,
    image: sku?.images?.[0]?.imageUrl ?? '',
    category: product.categories?.[0] ?? '',
    brand: product.brand ?? '',
    available: (offer?.AvailableQuantity ?? 0) > 0,
  }
}
