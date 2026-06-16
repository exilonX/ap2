/**
 * RAG Handlers
 *
 * - GET  /_v/acg/rag/status    — Check sync status (informational only)
 * - semanticSearch()           — Semantic search function, used by chat handler
 *
 * Bulk catalog sync lives in the standalone script (scripts/sync-catalog/)
 * so it can handle 10K+ products without VTEX IO's 30s request timeout.
 */

import { EmbeddingsClient } from '../clients/embeddings'
import { PineconeClient } from '../clients/pinecone'
import type { PineconeMatch } from '../clients/pinecone'

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

async function getAppSettings(ctx: Context): Promise<RagSettings> {
  return ctx.clients.apps
    .getAppSettings('vtexeurope.acg-adapter')
    .catch(() => ({}))
}

function createEmbeddingsClient(
  ctx: Context,
  settings: RagSettings
): EmbeddingsClient {
  if (!settings.openaiApiKey) {
    throw new Error('OpenAI API key not configured. Required for embeddings.')
  }

  return new EmbeddingsClient(ctx.vtex, { apiKey: settings.openaiApiKey })
}

function createPineconeClient(
  ctx: Context,
  settings: RagSettings
): PineconeClient {
  if (!settings.pineconeApiKey || !settings.pineconeIndexHost) {
    throw new Error('Pinecone API key and index host not configured.')
  }

  return new PineconeClient(ctx.vtex, {
    indexHost: settings.pineconeIndexHost,
    apiKey: settings.pineconeApiKey,
  })
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
      message: 'Bulk sync runs via scripts/sync-catalog/ (not this endpoint).',
    }
  }
}

// ─── Semantic Search Function (used by chat handler) ───────────

export async function semanticSearch(
  ctx: Context,
  query: string,
  topK = 5,
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
