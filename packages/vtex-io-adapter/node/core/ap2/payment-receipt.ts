/**
 * PaymentReceipt — the artifact emitted by the network after the full
 * cryptographic chain (CartMandate + PaymentMandate + verification)
 * has been evaluated.
 *
 * AP2 v0.2 doesn't formalize a PaymentReceipt class yet (canonical
 * Pydantic at code/sdk/python/ap2/models/mandate.py covers IntentMandate,
 * CartMandate, PaymentMandate only). This is our project-specific shape;
 * documented as a deviation in `docs/AP2_COMPLIANCE.md` until the spec
 * formalizes the receipt artifact.
 *
 * Design choices (per 2026-05-07 grilling Q8):
 *   - Same `{ contents, network_authorization }` shape as CartMandate
 *     for visual + cryptographic consistency.
 *   - JWS Ed25519 over JCS-canonical `PaymentReceiptContents`.
 *   - Always emitted on both approval AND rejection (signed evidence
 *     of the network's decision either way — same as a real payment
 *     authorization response). `verification_checks` carries the
 *     fine-grained 7-check result.
 *   - TTL = 1 hour. The receipt is post-approval evidence, not a
 *     short-lived authorization, so a longer window is fine.
 */

import { randomBytes, createPrivateKey, createPublicKey } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';

import { canonicalHash } from '../jcs';
import type { KeyPair } from '../did';
import type { AgentPresence } from './payment-mandate';
import type { PaymentCurrencyAmount } from './payment-request';

const PAYMENT_RECEIPT_TTL_SECONDS = 3600;

// ─── Types ───────────────────────────────────────────────────────

/**
 * The seven independent checks the network performs before signing a
 * receipt. All booleans must be true for `approval_status === 'approved'`.
 */
export interface VerificationChecks {
  /** CartMandate.merchant_authorization JWT signature valid against merchant DID. */
  merchant_signature: boolean;
  /** PaymentMandate.user_authorization JWT signature valid against CP DID. */
  cp_signature: boolean;
  /** transaction_data[0] matches hash(CartMandate) AND transaction_data[1] matches hash(PaymentMandateContents). */
  hash_binding: boolean;
  /** payment_details_total.amount equals CartMandate.contents.total. */
  amount_consistency: boolean;
  /** payment_details_id equals CartMandate.contents.id. */
  mandate_id_linking: boolean;
  /** PaymentMandate JWT not past its `exp`. */
  payment_mandate_not_expired: boolean;
  /** CartMandate JWT not past its `exp`. */
  cart_mandate_not_expired: boolean;
}

export interface PaymentReceiptContents {
  /** Unique identifier for this receipt. Format: `rcpt-<16 hex>`. */
  receipt_id: string;
  /** Linked PaymentMandate id. */
  payment_mandate_id: string;
  /** Linked CartMandate id (= PaymentMandate.payment_details_id). */
  cart_mandate_id: string;
  /** Network's DID (issuer of this receipt). */
  network_did: string;
  /** Merchant DID resolved at verification time (from CartMandate.iss). */
  merchant_did: string;
  /** CP DID resolved at verification time (from PaymentMandate.iss). */
  cp_did: string;
  /** Settlement amount (must equal CartMandate.contents.total). */
  amount: PaymentCurrencyAmount;
  /** Propagated from PaymentMandate.x_agent_presence. */
  agent_presence: AgentPresence;
  /** Per-check result. */
  verification_checks: VerificationChecks;
  /** Overall outcome — derived from verification_checks but materialized for clarity. */
  approval_status: 'approved' | 'rejected';
  /** Populated when approval_status === 'rejected'. Names the failing dimension. */
  rejection_reason?: string;
  /** ISO 8601 timestamp at receipt sign time. */
  approved_at: string;
}

/**
 * Top-level PaymentReceipt — same `{ contents, *_authorization }` shape
 * as CartMandate, signed by the network's key.
 */
export interface PaymentReceipt {
  contents: PaymentReceiptContents;
  network_authorization: string; // JWS Ed25519 by Network's key
}

export interface PaymentReceiptJWTPayload {
  iss: string; // Network DID
  sub: string; // receipt_id
  aud: string; // "ap2"
  iat: number;
  exp: number;
  jti: string;
  receipt_hash: string; // SHA-256 of JCS(PaymentReceiptContents)
}

export interface PaymentReceiptVerification {
  valid: boolean;
  checks: {
    signatureValid: boolean;
    notExpired: boolean;
    receiptHashMatches: boolean;
  };
  payload?: PaymentReceiptJWTPayload;
  error?: string;
}

// ─── Creation ────────────────────────────────────────────────────

export interface CreatePaymentReceiptInput {
  payment_mandate_id: string;
  cart_mandate_id: string;
  merchant_did: string;
  cp_did: string;
  amount: PaymentCurrencyAmount;
  agent_presence: AgentPresence;
  verification_checks: VerificationChecks;
  /** Set when ANY check failed; names the first failing dimension. */
  rejection_reason?: string;
}

export interface CreatePaymentReceiptOptions {
  /** Network's DID (will be embedded as `network_did` in the receipt). */
  networkDID: string;
  /** Network's keypair (signs the receipt). */
  networkKeys: KeyPair;
  /** Audience claim (default "ap2"). */
  audience?: string;
}

/**
 * Sign a PaymentReceipt. Always emitted, on both approve and reject —
 * the receipt is the network's signed evidence of its decision.
 *
 * `approval_status` is computed from `verification_checks`: all true =>
 * approved, any false => rejected.
 */
export async function createPaymentReceipt(
  input: CreatePaymentReceiptInput,
  options: CreatePaymentReceiptOptions
): Promise<PaymentReceipt> {
  const receiptId = generateReceiptId();
  const now = Math.floor(Date.now() / 1000);
  const exp = now + PAYMENT_RECEIPT_TTL_SECONDS;
  const audience = options.audience ?? 'ap2';

  const allChecksPassed = Object.values(input.verification_checks).every(Boolean);
  const approvalStatus: 'approved' | 'rejected' = allChecksPassed ? 'approved' : 'rejected';

  const contents: PaymentReceiptContents = {
    receipt_id: receiptId,
    payment_mandate_id: input.payment_mandate_id,
    cart_mandate_id: input.cart_mandate_id,
    network_did: options.networkDID,
    merchant_did: input.merchant_did,
    cp_did: input.cp_did,
    amount: input.amount,
    agent_presence: input.agent_presence,
    verification_checks: input.verification_checks,
    approval_status: approvalStatus,
    rejection_reason: approvalStatus === 'rejected' ? input.rejection_reason : undefined,
    approved_at: new Date(now * 1000).toISOString(),
  };

  const receiptHash = canonicalHash(contents).hash;

  const privateKeyObject = createPrivateKey({
    key: options.networkKeys.privateKey,
    format: 'der',
    type: 'pkcs8',
  });

  const networkAuthorization = await new SignJWT({ receipt_hash: receiptHash })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(options.networkDID)
    .setSubject(receiptId)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(randomBytes(16).toString('hex'))
    .sign(privateKeyObject);

  return {
    contents,
    network_authorization: networkAuthorization,
  };
}

// ─── Verification ────────────────────────────────────────────────

/**
 * Verify a PaymentReceipt against the network's public key.
 * Anyone with the network's DID document can call this — the receipt
 * is independently verifiable, the same way CartMandate is.
 */
export async function verifyPaymentReceipt(
  receipt: PaymentReceipt,
  networkPublicKey: Buffer
): Promise<PaymentReceiptVerification> {
  if (!receipt?.network_authorization || typeof receipt.network_authorization !== 'string') {
    return {
      valid: false,
      checks: {
        signatureValid: false,
        notExpired: false,
        receiptHashMatches: false,
      },
      error: 'malformed PaymentReceipt (missing network_authorization)',
    };
  }

  let payload: PaymentReceiptJWTPayload;
  try {
    const publicKeyObject = createPublicKey({
      key: networkPublicKey,
      format: 'der',
      type: 'spki',
    });
    const verified = await jwtVerify(receipt.network_authorization, publicKeyObject);
    payload = verified.payload as unknown as PaymentReceiptJWTPayload;
  } catch (err) {
    return {
      valid: false,
      checks: {
        signatureValid: false,
        notExpired: false,
        receiptHashMatches: false,
      },
      error: err instanceof Error ? err.message : 'signature verification failed',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const notExpired = payload.exp > now;

  const expectedHash = canonicalHash(receipt.contents).hash;
  const receiptHashMatches = payload.receipt_hash === expectedHash;

  const valid = notExpired && receiptHashMatches;

  return {
    valid,
    checks: {
      signatureValid: true,
      notExpired,
      receiptHashMatches,
    },
    payload,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────

function generateReceiptId(): string {
  return `rcpt-${randomBytes(8).toString('hex')}`;
}
