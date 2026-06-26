/**
 * Shared utilities: HTTP client (axios), chunking, sleep, atomic file writes, formatters.
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios'
import axiosRetry from 'axios-retry'
import { writeFile, rename, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

// ─── Axios HTTP client with retry built-in ─────────────────────

export interface HttpClientOptions {
  baseURL?: string
  headers?: Record<string, string>
  timeoutMs?: number
  retries?: number
}

/**
 * Create a configured axios instance with:
 *   - Request timeout (default 30s)
 *   - Automatic retry on 429/5xx with exponential backoff
 *   - JSON body handling
 *   - Throws on non-2xx (axios default)
 */
export function createHttpClient(options: HttpClientOptions = {}): AxiosInstance {
  const client = axios.create({
    baseURL: options.baseURL,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
    timeout: options.timeoutMs ?? 30_000,
    // Don't transform 4xx/5xx into non-errors — we want axios to throw
    validateStatus: (status) => status >= 200 && status < 300,
  })

  axiosRetry(client, {
    retries: options.retries ?? 5,
    retryDelay: (retryCount, error) => {
      // Honor the server's Retry-After (seconds or HTTP-date) when present —
      // VTEX 429s often send it and want a real cooldown, not a 100ms blip.
      const retryAfter = (error as AxiosError).response?.headers?.['retry-after'] as
        | string
        | undefined

      if (retryAfter) {
        const secs = Number(retryAfter)

        if (Number.isFinite(secs)) return secs * 1000

        const whenMs = Date.parse(retryAfter)

        if (!Number.isNaN(whenMs)) return Math.max(0, whenMs - Date.now())
      }

      // No header → exponential backoff with a 1s base (1s, 2s, 4s, 8s, 16s).
      return axiosRetry.exponentialDelay(retryCount, error, 1000)
    },
    retryCondition: (error: AxiosError) => {
      // Retry on network errors and on 429 / 5xx
      if (axiosRetry.isNetworkError(error)) return true
      if (!error.response) return true

      const status = error.response.status

      return status === 429 || status >= 500
    },
    onRetry: (retryCount, error, config) => {
      console.warn(
        `  ↻ Retry ${retryCount} for ${config.method?.toUpperCase()} ${config.url} — ${error.message}`
      )
    },
  })

  return client
}

/**
 * Classify an axios error into a structured shape for our error queue.
 */
export interface HttpErrorInfo {
  status: number | null
  url: string
  message: string
  data: unknown
}

export function describeAxiosError(error: unknown): HttpErrorInfo {
  if (axios.isAxiosError(error)) {
    return {
      status: error.response?.status ?? null,
      url: error.config?.url ?? 'unknown',
      message: error.message,
      data: error.response?.data ?? null,
    }
  }

  if (error instanceof Error) {
    return { status: null, url: '', message: error.message, data: null }
  }

  return { status: null, url: '', message: String(error), data: null }
}

// ─── Chunking ──────────────────────────────────────────────────

export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be > 0')

  const out: T[][] = []

  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size))
  }

  return out
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Atomic file write (avoid partial writes on crash) ─────────

export async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })

  const tmpPath = `${path}.tmp`
  const json = JSON.stringify(data, null, 2)

  await writeFile(tmpPath, json, 'utf-8')
  await rename(tmpPath, path)
}

// ─── Format helpers ────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`

  const hours = Math.floor(ms / 3600000)
  const mins = Math.floor((ms % 3600000) / 60000)

  return `${hours}h ${mins}m`
}

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(6)}`
  if (usd < 1) return `$${usd.toFixed(4)}`

  return `$${usd.toFixed(2)}`
}
