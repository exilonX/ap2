/**
 * Mandate Handlers
 *
 * GET /_v/acg/mandates/:mandateId
 *
 * Returns the full EvidenceBundle plus a structured verification result
 * (signature/expiry/hash). Verification runs on every GET — cost is
 * ~1ms with the cached MerchantIdentity. The "instructions paragraph"
 * the legacy handler returned is gone — the result tells the caller
 * what they need to know; `didDocumentUrl` lets them re-verify
 * independently.
 *
 * The legacy `POST /_v/acg/mandates` (`storeMandate`) was deleted by
 * Issue 01 — there's no longer any caller that needs to push a
 * pre-signed mandate; the only writer is `MandateOrchestration.signAndPersist`.
 */

import {
  MandateOrchestration,
  readOrderGroupMandateIndex,
} from '../mandates/mandate-orchestration'
import { buildMerchantIdentity, resolveMerchantDomain } from './did'

export async function getMandate(ctx: Context) {
  try {
    const mandateId = ctx.vtex.route?.params?.mandateId ?? ctx.params?.mandateId

    if (!mandateId || typeof mandateId !== 'string') {
      ctx.status = 400
      ctx.body = { error: 'Missing mandate ID' }

      return
    }

    const identity = buildMerchantIdentity(ctx)
    const orchestration = new MandateOrchestration({
      identity,
      vbase: ctx.clients.vbase,
    })

    const [bundle, verification] = await Promise.all([
      orchestration.retrieve(mandateId),
      orchestration.verify(mandateId),
    ])

    if (!bundle) {
      ctx.status = 404
      ctx.body = { error: 'Mandate not found' }

      return
    }

    const host = resolveMerchantDomain(ctx)

    ctx.body = {
      bundle,
      verification: {
        valid: verification.valid,
        checks: verification.checks,
        didDocumentUrl: `https://${host}/_v/acg/.well-known/did.json`,
      },
    }
  } catch (error) {
    console.error('Get mandate error:', error)
    ctx.status = 500
    ctx.body = {
      error: 'Failed to retrieve mandate',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * GET /_v/acg/mandates/by-order/:orderGroup
 *
 * Lookup the mandate ref by orderGroup — the seam the PPP payment
 * connector calls during its `authorize` callback, where it only knows
 * the OMS-side identifier.
 *
 * Response shape:
 *   { orderGroup, ref: { cartMandateId, didDocumentUrl, signedAt,
 *                        signedBy?, transactionId? },
 *     mandateUrl: 'https://.../_v/acg/mandates/:cartMandateId' }
 *
 * 404 when the orderGroup has no index entry (typical for orders placed
 * outside the ACG flow).
 */
export async function getMandateByOrderGroup(ctx: Context) {
  try {
    const orderGroup =
      ctx.vtex.route?.params?.orderGroup ?? ctx.params?.orderGroup

    if (!orderGroup || typeof orderGroup !== 'string') {
      ctx.status = 400
      ctx.body = { error: 'Missing orderGroup' }

      return
    }

    const ref = await readOrderGroupMandateIndex(ctx.clients.vbase, orderGroup)

    if (!ref) {
      ctx.status = 404
      ctx.body = {
        error: 'No mandate index entry for this orderGroup',
        orderGroup,
      }

      return
    }

    const host = resolveMerchantDomain(ctx)

    ctx.body = {
      orderGroup,
      ref,
      mandateUrl: `https://${host}/_v/acg/mandates/${ref.cartMandateId}`,
      didDocumentUrl: `https://${host}/_v/acg/.well-known/did.json`,
    }
  } catch (error) {
    console.error('Get mandate by orderGroup error:', error)
    ctx.status = 500
    ctx.body = {
      error: 'Failed to look up mandate by orderGroup',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
