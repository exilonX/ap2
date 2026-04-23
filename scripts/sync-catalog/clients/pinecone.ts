/**
 * Pinecone REST client using axios.
 *
 * Docs: https://docs.pinecone.io/reference/api/2024-10/data-plane/
 */

import type { AxiosInstance } from 'axios'
import axios from 'axios'

import type { Config, PineconeMatch, PineconeVector } from '../types.ts'
import { chunk, createHttpClient } from '../utils.ts'

const MAX_UPSERT_BATCH = 100

interface UpsertResponse {
  upsertedCount: number
}

interface QueryResponse {
  matches: PineconeMatch[]
  namespace: string
}

export class PineconeClient {
  private readonly http: AxiosInstance
  private readonly namespace: string

  constructor(config: Config['pinecone']) {
    this.http = createHttpClient({
      baseURL: `https://${config.indexHost}`,
      headers: { 'Api-Key': config.apiKey },
    })
    this.namespace = config.namespace
  }

  /**
   * Upsert vectors in batches. Returns total count upserted.
   */
  async upsert(vectors: PineconeVector[]): Promise<number> {
    let total = 0

    for (const batch of chunk(vectors, MAX_UPSERT_BATCH)) {
      const { data } = await this.http.post<UpsertResponse>('/vectors/upsert', {
        vectors: batch,
        namespace: this.namespace,
      })

      total += data.upsertedCount
    }

    return total
  }

  /**
   * Query for nearest neighbors.
   */
  async query(
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

    if (filter) body.filter = filter

    const { data } = await this.http.post<QueryResponse>('/query', body)

    return data.matches
  }

  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return

    await this.http.post('/vectors/delete', {
      ids,
      namespace: this.namespace,
    })
  }

  /**
   * Delete all vectors in the namespace. Used for --fresh runs.
   * Swallows 404 (empty namespace).
   */
  async deleteAll(): Promise<void> {
    try {
      await this.http.post('/vectors/delete', {
        deleteAll: true,
        namespace: this.namespace,
      })
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return
      }

      throw error
    }
  }
}
