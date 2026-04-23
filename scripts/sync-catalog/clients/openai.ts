/**
 * OpenAI Embeddings client using axios.
 *
 * Handles batch embedding with automatic splitting if batch exceeds API limits.
 */

import type { AxiosInstance } from 'axios'

import type { Config } from '../types.ts'
import { chunk, createHttpClient } from '../utils.ts'

const MAX_BATCH_SIZE = 100 // OpenAI supports up to 2048 but we batch smaller for safety

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

export interface EmbedResult {
  vectors: number[][]
  totalTokens: number
}

export class OpenAIClient {
  private readonly http: AxiosInstance
  private readonly model: string
  private readonly dimensions: number

  constructor(config: Config['openai']) {
    this.http = createHttpClient({
      baseURL: 'https://api.openai.com',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      timeoutMs: 60_000, // embeddings can be slow for large batches
    })
    this.model = config.model
    this.dimensions = config.dimensions
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embedBatch([text])

    return result.vectors[0]
  }

  /**
   * Embed multiple texts. Automatically splits into chunks of MAX_BATCH_SIZE.
   * Returns vectors in the same order as inputs.
   */
  async embedBatch(texts: string[]): Promise<EmbedResult> {
    const allVectors: number[][] = []
    let totalTokens = 0

    for (const batch of chunk(texts, MAX_BATCH_SIZE)) {
      const { data } = await this.http.post<EmbeddingResponse>('/v1/embeddings', {
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
      })

      // OpenAI returns embeddings with .index — sort to preserve input order
      const sorted = [...data.data].sort((a, b) => a.index - b.index)

      for (const item of sorted) {
        allVectors.push(item.embedding)
      }

      totalTokens += data.usage.total_tokens
    }

    return { vectors: allVectors, totalTokens }
  }
}
