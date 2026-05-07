/**
 * requireOriginOrSecret tests.
 *
 * Covers the truth table:
 *   - origin in allowlist               → 200 + CORS headers
 *   - X-ACG-Auth-Token matches          → 200 (no CORS — server-to-server)
 *   - both present, both valid          → 200 + CORS headers (origin path wins)
 *   - origin missing + no secret        → 403
 *   - origin not in allowlist           → 403
 *   - secret mismatch                   → 403
 *   - settings empty (fail-closed)      → 403
 *   - OPTIONS preflight + allowed       → 204 + CORS
 *   - OPTIONS preflight + not allowed   → 403
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { requireOriginOrSecret } from '../require-origin-or-secret'

interface FakeCtxOpts {
  method?: string
  origin?: string
  authToken?: string
  settings?: { acgAllowedOrigins?: string[]; acgAuthToken?: string }
}

function makeCtx(opts: FakeCtxOpts = {}) {
  const headers: Record<string, string> = {}

  if (opts.origin) headers.origin = opts.origin
  if (opts.authToken) headers['x-acg-auth-token'] = opts.authToken

  const responseHeaders: Record<string, string> = {}
  let status = 200
  let body: unknown

  const ctx = ({
    method: opts.method || 'GET',
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
    // Inspector handles
    _responseHeaders: responseHeaders,
  } as unknown) as Context & { _responseHeaders: Record<string, string> }

  return ctx
}

function makeNext() {
  let called = false
  const next = async () => {
    called = true
  }

  return {
    next,
    called: () => called,
  }
}

describe('requireOriginOrSecret — origin allowlist path', () => {
  it('allows when Origin is in the allowlist + sets CORS headers', async () => {
    const ctx = makeCtx({
      origin: 'https://acg--miniprix.myvtex.com',
      settings: {
        acgAllowedOrigins: ['https://acg--miniprix.myvtex.com'],
      },
    })

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), true)
    assert.equal(ctx.status, 200)
    assert.equal(
      (ctx as any)._responseHeaders['Access-Control-Allow-Origin'],
      'https://acg--miniprix.myvtex.com'
    )
    assert.equal((ctx as any)._responseHeaders.Vary, 'Origin')
    assert.equal(
      (ctx as any)._responseHeaders['Access-Control-Allow-Credentials'],
      'true'
    )
  })

  it('denies when Origin is NOT in the allowlist', async () => {
    const ctx = makeCtx({
      origin: 'https://evil.com',
      settings: {
        acgAllowedOrigins: ['https://acg--miniprix.myvtex.com'],
      },
    })

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), false)
    assert.equal(ctx.status, 403)
    assert.equal((ctx.body as any).error, 'forbidden')
    // No CORS headers leaked to the disallowed origin
    assert.equal(
      (ctx as any)._responseHeaders['Access-Control-Allow-Origin'],
      undefined
    )
  })
})

describe('requireOriginOrSecret — shared-secret path', () => {
  it('allows when X-ACG-Auth-Token matches the configured secret', async () => {
    const ctx = makeCtx({
      authToken: 'super-secret-32-chars-12345',
      settings: { acgAuthToken: 'super-secret-32-chars-12345' },
    })

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), true)
    assert.equal(ctx.status, 200)
    // No CORS headers on server-to-server path — there's no browser to satisfy.
    assert.equal(
      (ctx as any)._responseHeaders['Access-Control-Allow-Origin'],
      undefined
    )
  })

  it('denies when X-ACG-Auth-Token is wrong', async () => {
    const ctx = makeCtx({
      authToken: 'wrong-token',
      settings: { acgAuthToken: 'super-secret-32-chars-12345' },
    })

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), false)
    assert.equal(ctx.status, 403)
  })

  it('denies when no header AND no origin', async () => {
    const ctx = makeCtx({
      settings: {
        acgAllowedOrigins: ['https://acg--miniprix.myvtex.com'],
        acgAuthToken: 'super-secret',
      },
    })

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), false)
    assert.equal(ctx.status, 403)
  })
})

describe('requireOriginOrSecret — fail-closed', () => {
  it('denies when settings are empty (no allowlist + no secret)', async () => {
    const ctx = makeCtx({
      origin: 'https://acg--miniprix.myvtex.com',
      authToken: 'whatever',
      settings: {},
    })

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), false)
    assert.equal(ctx.status, 403)
  })

  it('denies when getAppSettings rejects (defensive: catch returns {})', async () => {
    const ctx = makeCtx({
      origin: 'https://acg--miniprix.myvtex.com',
    })

    // Override apps.getAppSettings to throw
    ;(ctx as any).clients.apps.getAppSettings = async () => {
      throw new Error('vbase down')
    }

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), false)
    assert.equal(ctx.status, 403)
  })
})

describe('requireOriginOrSecret — CORS preflight', () => {
  it('OPTIONS + allowed origin → 204 + full CORS headers, does NOT call next', async () => {
    const ctx = makeCtx({
      method: 'OPTIONS',
      origin: 'https://acg--miniprix.myvtex.com',
      settings: {
        acgAllowedOrigins: ['https://acg--miniprix.myvtex.com'],
      },
    })

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), false)
    assert.equal(ctx.status, 204)
    assert.equal(
      (ctx as any)._responseHeaders['Access-Control-Allow-Origin'],
      'https://acg--miniprix.myvtex.com'
    )
    assert.match(
      (ctx as any)._responseHeaders['Access-Control-Allow-Methods'],
      /POST/
    )
  })

  it('OPTIONS + disallowed origin → 403, no CORS headers leaked', async () => {
    const ctx = makeCtx({
      method: 'OPTIONS',
      origin: 'https://evil.com',
      settings: {
        acgAllowedOrigins: ['https://acg--miniprix.myvtex.com'],
      },
    })

    const { next, called } = makeNext()

    await requireOriginOrSecret(ctx, next)

    assert.equal(called(), false)
    assert.equal(ctx.status, 403)
    assert.equal(
      (ctx as any)._responseHeaders['Access-Control-Allow-Origin'],
      undefined
    )
  })
})
