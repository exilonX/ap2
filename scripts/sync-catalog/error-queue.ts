/**
 * Error queue — failed products for --retry runs.
 *
 * Stored at .sync-state/errors.json. Entries include retry metadata so we can
 * distinguish transient from permanent failures.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import axios from 'axios'

import type { ErrorKind, ProductError } from './types.ts'
import { atomicWriteJson } from './utils.ts'

const ERRORS_FILE = resolve(process.cwd(), '.sync-state', 'errors.json')

export class ErrorQueue {
  private errors: Map<number, ProductError> = new Map()
  private loaded = false

  async load(): Promise<void> {
    try {
      const content = await readFile(ERRORS_FILE, 'utf-8')
      const arr = JSON.parse(content) as ProductError[]

      for (const err of arr) {
        this.errors.set(err.productId, err)
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw error
      }
    }
    this.loaded = true
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error('ErrorQueue.load() must be called before use')
    }
  }

  async save(): Promise<void> {
    this.ensureLoaded()
    await atomicWriteJson(ERRORS_FILE, [...this.errors.values()])
  }

  add(productId: number, error: unknown): void {
    this.ensureLoaded()

    const now = new Date().toISOString()
    const kind = classifyError(error)
    const reason = error instanceof Error ? error.message : String(error)
    const existing = this.errors.get(productId)

    this.errors.set(productId, {
      productId,
      kind,
      reason,
      attempts: (existing?.attempts ?? 0) + 1,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      retryable: kind !== 'product_not_found',
    })
  }

  remove(productId: number): void {
    this.ensureLoaded()
    this.errors.delete(productId)
  }

  getRetryable(): ProductError[] {
    this.ensureLoaded()

    return [...this.errors.values()].filter((e) => e.retryable)
  }

  getAll(): ProductError[] {
    this.ensureLoaded()

    return [...this.errors.values()]
  }

  get size(): number {
    return this.errors.size
  }

  clear(): void {
    this.errors.clear()
  }
}

export function classifyError(error: unknown): ErrorKind {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const url = (error.config?.url ?? '').toLowerCase()

    if (status === 404) return 'product_not_found'
    if (status === 429) return 'rate_limit'

    if (url.includes('openai.com')) return 'embedding'
    if (url.includes('pinecone.io')) return 'pinecone'
    if (status && status >= 500) return 'vtex_fetch'
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return 'network'

    return 'vtex_fetch'
  }

  if (error instanceof Error && /fetch|network|econn|timeout/i.test(error.message)) {
    return 'network'
  }

  return 'unknown'
}
