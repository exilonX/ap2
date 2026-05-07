/**
 * Evidence Bundle
 *
 * The typed AP2 artifact persisted at sign time. Carries the full
 * CartMandate plus the stable claims that downstream verifiers care
 * about (cartHash, signedAt, signedBy) plus an opaque platform-specific
 * `metadata` field.
 *
 * `signedBy` is the merchant DID at sign time, captured as a string so
 * the bundle survives future key rotation — old bundles still record
 * the identity that signed them, even after the published DID document
 * lists a new public key.
 */

import type { CartMandate, MandateJWTPayload } from './mandates';
import type { PaymentMandate } from './ap2/payment-mandate';

// Re-export for callers that previously imported the stub from here.
// Real v0.2-canonical shape lives in `./ap2/payment-mandate.ts`.
export type { PaymentMandate };

export interface EvidenceBundle {
  mandateId: string;
  cartMandate: CartMandate;
  cartHash: string; // SHA-256 of JCS-canonicalized contents — matches JWT cart_hash
  paymentMandate?: PaymentMandate; // future
  signedAt: string; // ISO timestamp
  signedBy: string; // merchant DID at sign time (survives key rotation)
  metadata?: Record<string, unknown>;
}

/**
 * Extract the deterministic bits of an `EvidenceBundle` from a
 * CartMandate. `metadata` and `paymentMandate` aren't derivable from the
 * mandate alone — callers attach them.
 */
export function extractEvidenceBundle(
  mandate: CartMandate
): Omit<EvidenceBundle, 'metadata' | 'paymentMandate'> {
  if (!mandate?.merchant_authorization || typeof mandate.merchant_authorization !== 'string') {
    throw new Error('extractEvidenceBundle: malformed mandate (missing merchant_authorization JWT)');
  }
  const parts = mandate.merchant_authorization.split('.');
  if (parts.length !== 3) {
    throw new Error('extractEvidenceBundle: malformed JWT in merchant_authorization');
  }
  let payload: MandateJWTPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as MandateJWTPayload;
  } catch (err) {
    throw new Error(
      `extractEvidenceBundle: failed to decode JWT payload (${err instanceof Error ? err.message : 'unknown error'})`
    );
  }
  if (!payload.cart_hash || typeof payload.cart_hash !== 'string') {
    throw new Error('extractEvidenceBundle: JWT payload missing cart_hash claim');
  }
  if (typeof payload.iat !== 'number') {
    throw new Error('extractEvidenceBundle: JWT payload missing iat claim');
  }
  if (!mandate.contents?.id) {
    throw new Error('extractEvidenceBundle: mandate.contents.id is missing');
  }
  if (!mandate.contents.merchant_name) {
    throw new Error('extractEvidenceBundle: mandate.contents.merchant_name is missing');
  }
  return {
    mandateId: mandate.contents.id,
    cartMandate: mandate,
    cartHash: payload.cart_hash,
    signedAt: new Date(payload.iat * 1000).toISOString(),
    signedBy: mandate.contents.merchant_name,
  };
}
