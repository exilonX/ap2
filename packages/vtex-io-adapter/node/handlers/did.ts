/**
 * DID Document Handler
 *
 * Serves the merchant's DID document at /_v/acg/.well-known/did.json.
 * Contains the Ed25519 public key used to verify AP2 mandate signatures.
 *
 * The handler is a thin shell over `MerchantIdentity` — key generation,
 * persistence, and DID composition all live in the identity module.
 */

import { MerchantIdentity } from '../identity/merchant-identity'
import { VBaseKeyStore } from '../identity/vbase-keystore'

/**
 * Build the merchant DID domain from the request context.
 *
 * `master` workspace serves the bare account domain; other workspaces
 * are namespaced (matches VTEX's myvtex.com URL convention).
 */
export function resolveMerchantDomain(ctx: Context): string {
  const workspace = ctx.vtex.workspace || 'master'

  return workspace === 'master'
    ? `${ctx.vtex.account}.myvtex.com`
    : `${workspace}--${ctx.vtex.account}.myvtex.com`
}

/**
 * Build a fresh `MerchantIdentity` for the current request.
 *
 * Cheap — `VBaseKeyStore.read` is the actual cost, and that's
 * memoised inside `MerchantIdentity` after first load.
 */
export function buildMerchantIdentity(ctx: Context): MerchantIdentity {
  const keyStore = new VBaseKeyStore(ctx.clients.vbase)
  const domain = resolveMerchantDomain(ctx)

  return new MerchantIdentity({ keyStore, domain })
}

/**
 * GET /_v/acg/.well-known/did.json
 * Serve the merchant's DID document.
 */
export async function serveDIDDocument(ctx: Context) {
  try {
    const identity = buildMerchantIdentity(ctx)
    const didDocument = await identity.getDIDDocument()

    ctx.set('Content-Type', 'application/did+ld+json')
    ctx.set('Cache-Control', 'public, max-age=3600')
    ctx.body = didDocument
  } catch (error) {
    console.error('DID document error:', error)
    ctx.status = 500
    ctx.body = {
      error: 'Failed to serve DID document',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
