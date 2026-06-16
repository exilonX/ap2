/**
 * Pinecone Vector Store Client (REST API)
 *
 * No SDK needed — uses plain HTTP. Works within VTEX IO builder constraints.
 * Free tier: 100K vectors, 1 index, 2GB storage.
 */

import type { IOContext, InstanceOptions } from '@vtex/api'
import { ExternalClient } from '@vtex/api'

// ─── Types ─────────────────────────────────────────────────────

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

interface UpsertResponse {
  upsertedCount: number
}

interface QueryResponse {
  matches: PineconeMatch[]
  namespace: string
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface DeleteResponse {}

// ─── Client ────────────────────────────────────────────────────

export class PineconeClient extends ExternalClient {
  private namespace: string

  constructor(
    context: IOContext,
    options: InstanceOptions & {
      indexHost: string // e.g. "acg-products-xxxxx.svc.aped-1234.pinecone.io"
      apiKey: string
      namespace?: string
    }
  ) {
    super(`https://${options.indexHost}`, context, {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
        'Api-Key': options.apiKey,
      },
      timeout: 15000,
    })
    this.namespace = options.namespace || 'products'
  }

  /**
   * Upsert vectors into the index
   */
  public async upsert(vectors: PineconeVector[]): Promise<number> {
    const BATCH_SIZE = 100
    let totalUpserted = 0

    for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
      const batch = vectors.slice(i, i + BATCH_SIZE)
      // Sequential batches by design — don't hammer Pinecone with 100
      // parallel requests; their rate limits are per-second on writes.
      // eslint-disable-next-line no-await-in-loop
      const response = await this.http.post<UpsertResponse>(
        '/vectors/upsert',
        {
          vectors: batch,
          namespace: this.namespace,
        },
        { metric: 'acg-pinecone-upsert' }
      )

      totalUpserted += response.upsertedCount
    }

    return totalUpserted
  }

  /**
   * Query for similar vectors
   */
  public async query(
    vector: number[],
    topK = 5,
    filter?: Record<string, unknown>
  ): Promise<PineconeMatch[]> {
    const body: Record<string, unknown> = {
      vector,
      topK,
      namespace: this.namespace,
      includeMetadata: true,
    }

    if (filter) {
      body.filter = filter
    }

    const response = await this.http.post<QueryResponse>('/query', body, {
      metric: 'acg-pinecone-query',
    })

    return response.matches
  }

  /**
   * Delete vectors by ID
   */
  public async deleteByIds(ids: string[]): Promise<void> {
    await this.http.post<DeleteResponse>(
      '/vectors/delete',
      {
        ids,
        namespace: this.namespace,
      },
      { metric: 'acg-pinecone-delete' }
    )
  }

  /**
   * Delete all vectors in the namespace
   */
  public async deleteAll(): Promise<void> {
    await this.http.post<DeleteResponse>(
      '/vectors/delete',
      {
        deleteAll: true,
        namespace: this.namespace,
      },
      { metric: 'acg-pinecone-delete-all' }
    )
  }
}
