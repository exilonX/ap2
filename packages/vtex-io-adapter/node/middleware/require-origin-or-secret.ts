/**
 * requireOriginOrSecret — gate sensitive public routes behind one of two checks.
 *
 *   Either the request carries an `Origin` header in the merchant's allowlist
 *   (configured via app settings as `acgAllowedOrigins`), OR it carries a
 *   matching `X-ACG-Auth-Token` header (configured as `acgAuthToken`). One
 *   path covers browser callers (the chat widget), the other covers
 *   server-to-server callers (the MCP server, which has no Origin).
 *
 * Fails closed: if neither app setting is configured, every request is denied
 * with a 403. A misconfigured deploy is never accidentally open.
 *
 * The .well-known DID document routes do NOT mount this middleware — those
 * must remain anonymously accessible so external verifiers can fetch them
 * without coordinating with the merchant. Same for `/_v/acg/mandates/:id`,
 * `/_v/acg/payment-mandates/:id`, and `/_v/acg/receipts/:id` — those are the
 * verification surface and must be retrievable by anyone who has an id, the
 * AP2 punchline depends on it.
 *
 * Issue 0010 — Operational hardening of the public /_v/acg/* surface (item 5).
 */

const ALLOWED_HEADER = 'x-acg-auth-token'
const APP_NAME = 'vtexeurope.acg-adapter'

interface SecuritySettings {
  acgAllowedOrigins?: string[]
  acgAuthToken?: string
}

async function loadSettings(ctx: Context): Promise<SecuritySettings> {
  return ctx.clients.apps
    .getAppSettings(APP_NAME)
    .catch(() => ({} as SecuritySettings))
}

function originAllowed(
  origin: string,
  allowlist: string[] | undefined
): boolean {
  if (!origin || !allowlist || allowlist.length === 0) return false

  return allowlist.includes(origin)
}

function secretMatches(
  headerValue: string,
  expected: string | undefined
): boolean {
  if (!headerValue || !expected) return false

  return headerValue === expected
}

export async function requireOriginOrSecret(
  ctx: Context,
  next: () => Promise<void>
): Promise<void> {
  const settings = await loadSettings(ctx)
  const origin = ctx.get('origin') || ''
  const headerSecret = ctx.get(ALLOWED_HEADER) || ''
  const isOriginAllowed = originAllowed(origin, settings.acgAllowedOrigins)
  const isSecretValid = secretMatches(headerSecret, settings.acgAuthToken)

  // Browser preflight: the actual cross-origin XHR will follow if we permit.
  // Reject upfront if neither check passes so we don't reveal CORS headers
  // to disallowed origins.
  if (ctx.method === 'OPTIONS') {
    if (!isOriginAllowed) {
      ctx.status = 403
      ctx.body = { error: 'forbidden', message: 'origin not allowed' }

      return
    }

    setCorsHeaders(ctx, origin)
    ctx.status = 204

    return
  }

  if (isOriginAllowed) {
    setCorsHeaders(ctx, origin)

    return next()
  }

  if (isSecretValid) {
    return next()
  }

  ctx.status = 403
  ctx.body = {
    error: 'forbidden',
    message:
      'request origin not allowed and no valid X-ACG-Auth-Token provided',
  }
}

function setCorsHeaders(ctx: Context, origin: string): void {
  ctx.set('Access-Control-Allow-Origin', origin)
  ctx.set('Vary', 'Origin')
  ctx.set('Access-Control-Allow-Credentials', 'true')
  ctx.set(
    'Access-Control-Allow-Headers',
    'Content-Type, X-ACG-Order-Form-Id, X-ACG-Auth-Token'
  )
  ctx.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
}
