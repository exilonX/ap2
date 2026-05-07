/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * getOrderStatus auth guard tests (issue 0010 — orders auth fix).
 *
 * The handler doesn't return customer PII, but it does leak whether an
 * orderId exists in the ACG namespace. The middleware tier (origin
 * allowlist + IP rate limit) caps who can hit this and how fast; this
 * handler-level check is defense-in-depth — require an active session
 * (orderFormId header or cookie) before responding at all.
 *
 * Covers:
 *   - Missing orderFormId → 401
 *   - With orderFormId header → 200
 *   - With orderFormId cookie → 200
 *   - Missing orderId in URL params → 400 (precedes the auth check)
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { getOrderStatus } from '../checkout'

interface FakeCtxOpts {
  orderId?: string
  orderFormHeader?: string
  ofidCookie?: string
}

function makeCtx(opts: FakeCtxOpts) {
  const headers: Record<string, string> = {}

  if (opts.orderFormHeader) {
    headers['x-acg-order-form-id'] = opts.orderFormHeader
  }

  let status = 200
  let body: any

  return ({
    vtex: { route: { params: { orderId: opts.orderId } } },
    params: { orderId: opts.orderId },
    get: (name: string) => headers[name.toLowerCase()] || '',
    cookies: {
      get: (_name: string) => opts.ofidCookie || undefined,
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
    set body(v: any) {
      body = v
    },
    clients: {
      vbase: {
        getJSON: async () => null,
      },
    },
  } as unknown) as Context
}

describe('getOrderStatus — auth guard', () => {
  it('returns 401 when no session is present', async () => {
    const ctx = makeCtx({ orderId: 'ACG-DEMO-12345' })

    await getOrderStatus(ctx)

    assert.equal(ctx.status, 401)
    assert.equal((ctx.body as any).error, 'unauthorized')
  })

  it('returns 200 when X-ACG-Order-Form-Id header is present', async () => {
    const ctx = makeCtx({
      orderId: 'ACG-DEMO-12345',
      orderFormHeader: 'of-abc',
    })

    await getOrderStatus(ctx)

    assert.equal(ctx.status, 200)
    assert.equal((ctx.body as any).orderId, 'ACG-DEMO-12345')
  })

  it('returns 200 when the storefront cookie carries the orderForm', async () => {
    const ctx = makeCtx({
      orderId: 'ACG-DEMO-67890',
      ofidCookie: '__ofid=of-cookie-session',
    })

    await getOrderStatus(ctx)

    assert.equal(ctx.status, 200)
  })

  it('returns 400 when orderId is missing — predates the auth check', async () => {
    const ctx = makeCtx({}) // no orderId, no session

    await getOrderStatus(ctx)

    assert.equal(ctx.status, 400)
    assert.match((ctx.body as any).error, /missing order id/i)
  })
})
