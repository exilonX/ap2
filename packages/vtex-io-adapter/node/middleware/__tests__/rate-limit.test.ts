/* eslint-disable no-await-in-loop, jest/expect-expect, @typescript-eslint/no-explicit-any */
/**
 * rateLimit tests.
 *
 * Covers:
 *   - InMemoryRateLimitStore: counts, resets when window passes, denies at limit
 *   - rateLimit middleware: minute window denies before day window, both reset cleanly
 *   - Per-IP isolation: separate IPs get independent quotas
 *   - X-Forwarded-For parsing: takes first hop, not gateway
 *   - Settings override: acgRateLimits replaces DEFAULT_LIMITS for that class
 *   - Settings missing / throws: defaults are honored
 *
 * eslint-disable: sequential awaits are intentional (each call increments
 * the counter); jest/expect-expect doesn't recognize node:assert; the `any`
 * casts are restricted to the fake-ctx test harness.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_LIMITS,
  InMemoryRateLimitStore,
  rateLimit,
} from '../rate-limit'

interface FakeCtxOpts {
  ip?: string
  forwardedFor?: string
  settings?: { acgRateLimits?: any }
}

function makeCtx(opts: FakeCtxOpts = {}) {
  const headers: Record<string, string> = {}

  if (opts.forwardedFor) headers['x-forwarded-for'] = opts.forwardedFor

  const responseHeaders: Record<string, string> = {}
  let status = 200
  let body: unknown

  return ({
    method: 'POST',
    ip: opts.ip || '127.0.0.1',
    get: (name: string) => headers[name.toLowerCase()] || '',
    set: (name: string, value: string) => {
      responseHeaders[name] = value
    },
    get status() {
      return status
    },
    set status(v: number) {
      status = v
    },
    get body() {
      return body
    },
    set body(v: unknown) {
      body = v
    },
    clients: {
      apps: {
        getAppSettings: async () => opts.settings || {},
      },
    },
    _responseHeaders: responseHeaders,
  } as unknown) as Context & { _responseHeaders: Record<string, string> }
}

function fakeClock(initial: number) {
  let t = initial

  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
    },
  }
}

describe('InMemoryRateLimitStore', () => {
  it('admits requests up to the limit, then denies', () => {
    const store = new InMemoryRateLimitStore()
    const now = 1_000_000

    assert.equal(store.consume('k', 60_000, 3, now), true)
    assert.equal(store.consume('k', 60_000, 3, now), true)
    assert.equal(store.consume('k', 60_000, 3, now), true)
    assert.equal(store.consume('k', 60_000, 3, now), false)
  })

  it('resets the counter when the window passes', () => {
    const store = new InMemoryRateLimitStore()
    const t0 = 1_000_000

    assert.equal(store.consume('k', 60_000, 1, t0), true)
    assert.equal(store.consume('k', 60_000, 1, t0), false)
    // 60s + 1ms later the window has elapsed
    assert.equal(store.consume('k', 60_000, 1, t0 + 60_001), true)
  })

  it('keeps separate keys independent', () => {
    const store = new InMemoryRateLimitStore()
    const now = 1_000_000

    assert.equal(store.consume('a', 60_000, 1, now), true)
    assert.equal(store.consume('a', 60_000, 1, now), false)
    // 'b' has its own bucket
    assert.equal(store.consume('b', 60_000, 1, now), true)
  })
})

describe('rateLimit middleware — minute window', () => {
  it('admits up to chat perMinute, then 429s with Retry-After', async () => {
    const ctx = makeCtx()
    const minuteStore = new InMemoryRateLimitStore()
    const dayStore = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = rateLimit('chat', {
      minuteStore,
      dayStore,
      now: clock.now,
    })

    let nextCalled = 0
    const next = async () => {
      nextCalled++
    }

    // Default chat limits: perMinute = 20
    for (let i = 0; i < DEFAULT_LIMITS.chat.perMinute; i++) {
      await mw(ctx, next)
    }

    assert.equal(nextCalled, DEFAULT_LIMITS.chat.perMinute)
    assert.equal(ctx.status, 200)

    // 21st request in the same minute fails
    await mw(ctx, next)
    assert.equal(nextCalled, DEFAULT_LIMITS.chat.perMinute)
    assert.equal(ctx.status, 429)
    assert.equal((ctx as any)._responseHeaders['Retry-After'], '60')
    assert.equal((ctx.body as any).window, 'minute')
  })

  it('lets requests through again after the minute rolls over', async () => {
    const ctx = makeCtx()
    const minuteStore = new InMemoryRateLimitStore()
    const dayStore = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = rateLimit('chat', {
      minuteStore,
      dayStore,
      now: clock.now,
    })

    let nextCalled = 0
    const next = async () => {
      nextCalled++
    }

    // Burn through minute quota
    for (let i = 0; i < DEFAULT_LIMITS.chat.perMinute; i++) await mw(ctx, next)
    await mw(ctx, next) // 429
    assert.equal(ctx.status, 429)

    // Roll forward one full minute + 1ms
    clock.advance(60_001)
    // ctx.status carries over from prior call — reset it
    ctx.status = 200
    await mw(ctx, next)
    assert.equal(nextCalled, DEFAULT_LIMITS.chat.perMinute + 1)
    assert.equal(ctx.status, 200)
  })
})

describe('rateLimit middleware — day window', () => {
  it('429s when daily limit hit even within minute budget', async () => {
    const ctx = makeCtx({
      settings: {
        acgRateLimits: {
          // Per-day limit lower than per-minute so we can exhaust it without
          // tripping the minute guard first.
          chat: { perMinute: 100, perDay: 2 },
        },
      },
    })

    const minuteStore = new InMemoryRateLimitStore()
    const dayStore = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = rateLimit('chat', {
      minuteStore,
      dayStore,
      now: clock.now,
    })

    const next = async () => {}

    await mw(ctx, next)
    assert.equal(ctx.status, 200)
    await mw(ctx, next)
    assert.equal(ctx.status, 200)

    await mw(ctx, next)
    assert.equal(ctx.status, 429)
    assert.equal((ctx.body as any).window, 'day')
    assert.equal((ctx as any)._responseHeaders['Retry-After'], '3600')
  })
})

describe('rateLimit middleware — per-IP isolation', () => {
  it('different IPs get independent quotas', async () => {
    const ctxA = makeCtx({ ip: '1.1.1.1' })
    const ctxB = makeCtx({ ip: '2.2.2.2' })
    const minuteStore = new InMemoryRateLimitStore()
    const dayStore = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = rateLimit('chat', {
      minuteStore,
      dayStore,
      now: clock.now,
    })

    const next = async () => {}

    // Burn ctxA's minute quota
    for (let i = 0; i < DEFAULT_LIMITS.chat.perMinute; i++) {
      await mw(ctxA, next)
    }

    await mw(ctxA, next)
    assert.equal(ctxA.status, 429)

    // ctxB still has its full quota
    await mw(ctxB, next)
    assert.equal(ctxB.status, 200)
  })

  it('uses X-Forwarded-For as the client IP, not ctx.ip (gateway)', async () => {
    // ctx.ip is the gateway; XFF is the real client. If we used ctx.ip we'd
    // coalesce all users into one bucket and one user could lock out everyone.
    const realClient = '5.5.5.5'
    const otherClient = '6.6.6.6'
    const ctxA = makeCtx({
      ip: '10.0.0.1',
      forwardedFor: `${realClient}, 10.0.0.1`,
    })

    const ctxB = makeCtx({
      ip: '10.0.0.1', // same gateway
      forwardedFor: `${otherClient}, 10.0.0.1`,
    })

    const minuteStore = new InMemoryRateLimitStore()
    const dayStore = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = rateLimit('chat', {
      minuteStore,
      dayStore,
      now: clock.now,
    })

    const next = async () => {}

    for (let i = 0; i < DEFAULT_LIMITS.chat.perMinute; i++) {
      await mw(ctxA, next)
    }

    await mw(ctxA, next)
    assert.equal(ctxA.status, 429)

    // Different XFF → different bucket → still allowed
    await mw(ctxB, next)
    assert.equal(ctxB.status, 200)
  })
})

describe('rateLimit middleware — settings override', () => {
  it('honors acgRateLimits from app settings', async () => {
    const ctx = makeCtx({
      settings: {
        acgRateLimits: {
          chat: { perMinute: 2, perDay: 100 },
        },
      },
    })

    const minuteStore = new InMemoryRateLimitStore()
    const dayStore = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = rateLimit('chat', {
      minuteStore,
      dayStore,
      now: clock.now,
    })

    const next = async () => {}

    await mw(ctx, next)
    assert.equal(ctx.status, 200)
    await mw(ctx, next)
    assert.equal(ctx.status, 200)
    await mw(ctx, next)
    assert.equal(ctx.status, 429)
  })

  it('falls back to defaults if getAppSettings throws', async () => {
    const ctx = makeCtx()

    ;(ctx as any).clients.apps.getAppSettings = async () => {
      throw new Error('vbase down')
    }

    const minuteStore = new InMemoryRateLimitStore()
    const dayStore = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = rateLimit('chat', {
      minuteStore,
      dayStore,
      now: clock.now,
    })

    const next = async () => {}

    // Default chat perMinute = 20 — should accept 20 requests
    for (let i = 0; i < DEFAULT_LIMITS.chat.perMinute; i++) {
      await mw(ctx, next)
    }

    assert.equal(ctx.status, 200)
    await mw(ctx, next)
    assert.equal(ctx.status, 429)
  })
})
