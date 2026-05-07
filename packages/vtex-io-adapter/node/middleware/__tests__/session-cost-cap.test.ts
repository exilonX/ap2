/* eslint-disable no-await-in-loop, jest/expect-expect, @typescript-eslint/no-explicit-any */
/**
 * sessionCostCap tests.
 *
 * Covers:
 *   - No orderFormId → passthrough
 *   - With orderFormId, under the cap → next() called
 *   - Over the cap → 429 + Retry-After
 *   - Different orderFormIds get independent quotas
 *   - app setting acgSessionDailyLimit overrides default
 *   - getAppSettings throwing → uses default
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_SESSION_DAILY_LIMIT,
  sessionCostCap,
} from '../session-cost-cap'
import { InMemoryRateLimitStore } from '../rate-limit'

interface FakeCtxOpts {
  orderFormId?: string
  fromCookie?: string
  settings?: { acgSessionDailyLimit?: number }
}

function makeCtx(opts: FakeCtxOpts = {}) {
  const headers: Record<string, string> = {}

  if (opts.orderFormId) headers['x-acg-order-form-id'] = opts.orderFormId

  const responseHeaders: Record<string, string> = {}
  let status = 200
  let body: unknown

  return ({
    method: 'POST',
    get: (name: string) => headers[name.toLowerCase()] || '',
    set: (name: string, value: string) => {
      responseHeaders[name] = value
    },
    cookies: {
      get: (_name: string) => opts.fromCookie || undefined,
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

describe('sessionCostCap — no session', () => {
  it('passes through when no orderFormId is present', async () => {
    const ctx = makeCtx() // no header, no cookie
    const store = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = sessionCostCap({ store, now: clock.now })
    let called = false
    const next = async () => {
      called = true
    }

    await mw(ctx, next)

    assert.equal(called, true)
    assert.equal(ctx.status, 200)
  })
})

describe('sessionCostCap — with session', () => {
  it('admits up to the limit, then 429s', async () => {
    const ctx = makeCtx({
      orderFormId: 'of-abc',
      settings: { acgSessionDailyLimit: 3 },
    })

    const store = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = sessionCostCap({ store, now: clock.now })
    let nextCalled = 0
    const next = async () => {
      nextCalled++
    }

    await mw(ctx, next)
    await mw(ctx, next)
    await mw(ctx, next)
    assert.equal(nextCalled, 3)
    assert.equal(ctx.status, 200)

    // 4th request in the same 24h fails
    await mw(ctx, next)
    assert.equal(nextCalled, 3)
    assert.equal(ctx.status, 429)
    assert.equal((ctx.body as any).scope, 'session')
    assert.equal((ctx as any)._responseHeaders['Retry-After'], '3600')
  })

  it('different orderFormIds get independent quotas', async () => {
    const ctxA = makeCtx({
      orderFormId: 'of-aaa',
      settings: { acgSessionDailyLimit: 1 },
    })

    const ctxB = makeCtx({
      orderFormId: 'of-bbb',
      settings: { acgSessionDailyLimit: 1 },
    })

    const store = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = sessionCostCap({ store, now: clock.now })
    const next = async () => {}

    await mw(ctxA, next)
    assert.equal(ctxA.status, 200)
    await mw(ctxA, next)
    assert.equal(ctxA.status, 429)

    // Different session, fresh quota
    await mw(ctxB, next)
    assert.equal(ctxB.status, 200)
  })

  it('quota resets after 24h', async () => {
    const ctx = makeCtx({
      orderFormId: 'of-abc',
      settings: { acgSessionDailyLimit: 1 },
    })

    const store = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = sessionCostCap({ store, now: clock.now })
    const next = async () => {}

    await mw(ctx, next)
    assert.equal(ctx.status, 200)
    await mw(ctx, next)
    assert.equal(ctx.status, 429)

    // Roll forward 24h + 1ms
    clock.advance(24 * 60 * 60_000 + 1)
    ctx.status = 200 // reset for new request
    await mw(ctx, next)
    assert.equal(ctx.status, 200)
  })

  it('uses default when getAppSettings throws', async () => {
    const ctx = makeCtx({ orderFormId: 'of-abc' })

    ;(ctx as any).clients.apps.getAppSettings = async () => {
      throw new Error('vbase down')
    }

    const store = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = sessionCostCap({ store, now: clock.now })
    let nextCalled = 0
    const next = async () => {
      nextCalled++
    }

    // Should accept up to DEFAULT_SESSION_DAILY_LIMIT (100) requests
    for (let i = 0; i < DEFAULT_SESSION_DAILY_LIMIT; i++) {
      await mw(ctx, next)
    }

    assert.equal(nextCalled, DEFAULT_SESSION_DAILY_LIMIT)
    assert.equal(ctx.status, 200)

    await mw(ctx, next)
    assert.equal(ctx.status, 429)
  })
})

describe('sessionCostCap — cookie fallback', () => {
  it('reads orderFormId from cookie when header is absent', async () => {
    // Widget path: orderFormId arrives via cookie, not header
    const ctx = makeCtx({
      fromCookie: '__ofid=of-cookie-session',
      settings: { acgSessionDailyLimit: 1 },
    })

    const store = new InMemoryRateLimitStore()
    const clock = fakeClock(1_000_000)
    const mw = sessionCostCap({ store, now: clock.now })
    const next = async () => {}

    await mw(ctx, next)
    assert.equal(ctx.status, 200)
    // Second call against the same cookie session is throttled
    await mw(ctx, next)
    assert.equal(ctx.status, 429)
  })
})
