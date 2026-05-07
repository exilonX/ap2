/**
 * sessionCostCap — per-session ceiling on chat requests over a 24h window.
 *
 * The IP-keyed rate limit (rate-limit.ts) catches scripted abuse from a
 * single source. This middleware catches the *other* failure mode: a
 * legitimate, allowlisted, on-rate-limit caller whose chat session loops
 * (intentional or accidental) and burns LLM tokens. The IP path doesn't
 * notice because the same IP under one quota can host many sessions; the
 * session path doesn't care about IP.
 *
 * Keying:
 *   - Uses orderFormId (the existing VTEX cart session id) as the session
 *     key. Same orderFormId = same shopping conversation, regardless of
 *     surface (widget cookie or MCP header).
 *   - If no orderFormId is present (very first chat-before-any-cart), the
 *     middleware is a no-op — IP rate-limiting still applies.
 *
 * Default cap: 100 chat requests per orderFormId per 24h. A real busy
 * user has 30-50; a runaway loop hits this in seconds. Configurable via
 * the `acgSessionDailyLimit` app setting.
 *
 * Storage is in-memory per instance. Same trade-off + caveat as rate-limit.
 *
 * Issue 0010 — Operational hardening of the public /_v/acg/* surface (item 3).
 */

import { getOrderFormIdFromRequest } from '../utils/session'
import { InMemoryRateLimitStore } from './rate-limit'
import type { RateLimitStore } from './rate-limit'

const APP_NAME = 'vtexeurope.acg-adapter'
const DAY_MS = 24 * 60 * 60_000

export const DEFAULT_SESSION_DAILY_LIMIT = 100

interface SessionCostCapSettings {
  acgSessionDailyLimit?: number
}

async function loadLimit(ctx: Context): Promise<number> {
  try {
    const settings: SessionCostCapSettings = await ctx.clients.apps.getAppSettings(
      APP_NAME
    )

    return settings.acgSessionDailyLimit ?? DEFAULT_SESSION_DAILY_LIMIT
  } catch {
    return DEFAULT_SESSION_DAILY_LIMIT
  }
}

const sharedStore = new InMemoryRateLimitStore()

export interface SessionCostCapOptions {
  /** Override the store (tests). */
  store?: RateLimitStore
  /** Override the clock (tests). */
  now?: () => number
}

export function sessionCostCap(options?: SessionCostCapOptions) {
  const store = options?.store || sharedStore
  const clock = options?.now || (() => Date.now())

  return async function sessionCostCapMiddleware(
    ctx: Context,
    next: () => Promise<void>
  ): Promise<void> {
    const orderFormId = getOrderFormIdFromRequest(ctx)

    if (!orderFormId) {
      // No session yet — IP-based rate limit is the only guard. Passthrough.
      return next()
    }

    const limit = await loadLimit(ctx)
    const key = `session:${orderFormId}`

    if (!store.consume(key, DAY_MS, limit, clock())) {
      ctx.status = 429
      ctx.set('Retry-After', '3600')
      ctx.body = {
        error: 'rate_limited',
        scope: 'session',
        limit,
        message: `this shopping session has hit its daily request cap (${limit} per 24h). Wait or start a new cart.`,
      }

      return
    }

    return next()
  }
}
