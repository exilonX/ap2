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

import { MandateOrchestration } from '../mandates/mandate-orchestration';
import { buildMerchantIdentity, resolveMerchantDomain } from './did';

export async function getMandate(ctx: Context) {
  try {
    const mandateId = ctx.vtex.route?.params?.mandateId ?? ctx.params?.mandateId;
    if (!mandateId || typeof mandateId !== 'string') {
      ctx.status = 400;
      ctx.body = { error: 'Missing mandate ID' };
      return;
    }

    const identity = buildMerchantIdentity(ctx);
    const orchestration = new MandateOrchestration({
      identity,
      vbase: ctx.clients.vbase,
    });

    const [bundle, verification] = await Promise.all([
      orchestration.retrieve(mandateId),
      orchestration.verify(mandateId),
    ]);

    if (!bundle) {
      ctx.status = 404;
      ctx.body = { error: 'Mandate not found' };
      return;
    }

    const host = resolveMerchantDomain(ctx);
    ctx.body = {
      bundle,
      verification: {
        valid: verification.valid,
        checks: verification.checks,
        didDocumentUrl: `https://${host}/_v/acg/.well-known/did.json`,
      },
    };
  } catch (error) {
    console.error('Get mandate error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to retrieve mandate',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
