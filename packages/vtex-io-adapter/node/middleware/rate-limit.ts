/**
 * rateLimit — per-IP rolling-window throttling for sensitive routes.
 *
 * Two windows are enforced together: a 60-second burst window and a
 * 24-hour sustained window. Both must pass; the first to fail returns
 * 429 with a Retry-After hint.
 *
 * Defaults are hardcoded but can be overridden per-merchant via the
 * `acgRateLimits` app setting:
 *
 *   {
 *     chat:     { perMinute: 20, perDay: 200  }   // LLM-backed (most expensive)
 *     mutating: { perMinute: 30, perDay: 500  }   // /cart/*, /checkout/*, /payment/*
 *     read:     { perMinute: 60, perDay: 2000 }   // /search, /mandates/:id, etc.
 *   }
 *
 * Storage is in-memory per instance — sufficient for the demo. Worst case
 * on instance restart: an attacker gets one fresh quota burst, then is
 * throttled again. Trade-off documented in issue 0010.
 *
 * The store is injectable so tests can pass a fresh instance and a fake
 * clock without polluting global state.
 *
 * Issue 0010 — Operational hardening of the public /_v/acg/* surface (item 2).
 */

const APP_NAME = 'vtexeurope.acg-adapter'
const MINUTE_MS = 60_000
const DAY_MS = 24 * 60 * 60_000

export type RouteClass = 'chat' | 'mutating' | 'read'

export interface Limits {
  perMinute: number
  perDay: number
}

export const DEFAULT_LIMITS: Record<RouteClass, Limits> = {
  chat: { perMinute: 20, perDay: 200 },
  mutating: { perMinute: 30, perDay: 500 },
  read: { perMinute: 60, perDay: 2000 },
}

interface Window {
  count: number
  resetAt: number
}

export interface RateLimitStore {
  /** Returns true if the request fits inside the limit; false if exceeded. */
  consume(key: string, windowMs: number, limit: number, now: number): boolean
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Window>()

  public consume(
    key: string,
    windowMs: number,
    limit: number,
    now: number
  ): boolean {
    const w = this.buckets.get(key)

    if (!w || w.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs })

      return true
    }

    if (w.count >= limit) return false

    w.count++

    return true
  }
}

interface RateLimitSettings {
  acgRateLimits?: Partial<Record<RouteClass, Limits>>
}

async function loadLimits(
  ctx: Context,
  routeClass: RouteClass
): Promise<Limits> {
  try {
    const settings: RateLimitSettings = await ctx.clients.apps.getAppSettings(
      APP_NAME
    )

    return settings.acgRateLimits?.[routeClass] || DEFAULT_LIMITS[routeClass]
  } catch {
    return DEFAULT_LIMITS[routeClass]
  }
}

function getClientIp(ctx: Context): string {
  // VTEX IO terminates TLS at the gateway. The client IP arrives in
  // X-Forwarded-For; ctx.ip is the gateway's IP and would coalesce all
  // real users into one bucket if used directly.
  const xff = ctx.get('x-forwarded-for') || ''
  const first = xff.split(',')[0]?.trim()

  return first || ctx.ip || 'unknown'
}

const sharedMinuteStore = new InMemoryRateLimitStore()
const sharedDayStore = new InMemoryRateLimitStore()

export interface RateLimitOptions {
  /** Override the minute-window store (tests). */
  minuteStore?: RateLimitStore
  /** Override the day-window store (tests). */
  dayStore?: RateLimitStore
  /** Override the clock (tests). */
  now?: () => number
}

export function rateLimit(routeClass: RouteClass, options?: RateLimitOptions) {
  const minuteStore = options?.minuteStore || sharedMinuteStore
  const dayStore = options?.dayStore || sharedDayStore
  const clock = options?.now || (() => Date.now())

  return async function rateLimitMiddleware(
    ctx: Context,
    next: () => Promise<void>
  ): Promise<void> {
    const limits = await loadLimits(ctx, routeClass)
    const ip = getClientIp(ctx)
    const key = `${routeClass}:${ip}`
    const now = clock()

    if (!minuteStore.consume(key, MINUTE_MS, limits.perMinute, now)) {
      ctx.status = 429
      ctx.set('Retry-After', '60')
      ctx.body = {
        error: 'rate_limited',
        window: 'minute',
        limit: limits.perMinute,
        message: `too many ${routeClass} requests in the last minute (limit ${limits.perMinute})`,
      }

      return
    }

    if (!dayStore.consume(key, DAY_MS, limits.perDay, now)) {
      ctx.status = 429
      ctx.set('Retry-After', '3600')
      ctx.body = {
        error: 'rate_limited',
        window: 'day',
        limit: limits.perDay,
        message: `daily ${routeClass} request limit exceeded (limit ${limits.perDay} per 24h)`,
      }

      return
    }

    return next()
  }
}
