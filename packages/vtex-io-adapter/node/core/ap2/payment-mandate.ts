/**
 * AP2 PaymentMandate — v0.2-canonical types and signing primitives.
 *
 * Mirrored from:
 *   https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/models/mandate.py
 *
 * Per AP2 §4.1.3, PaymentMandate is bound to the CartMandate but carries
 * separate information for the network/issuer — chiefly the
 * agent-presence and human-present signals so the network can build
 * trust into the agentic transaction.
 *
 * Trust model:
 *   - PaymentMandate.user_authorization is a JWT signed by a
 *     Credentials Provider (CP) acting on the user's behalf.
 *   - The JWT's `transaction_data` claim carries the SHA-256 hashes of
 *     CartMandate and PaymentMandateContents — binding all three
 *     artifacts cryptographically.
 *   - At pay time, the network verifies (a) CP signature, (b) merchant
 *     signature on CartMandate, (c) hash binding, (d) amounts match.
 *
 * Deviation from spec (documented in AP2_COMPLIANCE.md):
 *   - user_authorization is an Ed25519 JWS (matching CartMandate),
 *     not a full sd-jwt-vc with KB-JWT and selective disclosure.
 *     The cryptographic content (signature over transaction_data) is
 *     equivalent; the representation is simpler. v1.x post-demo work
 *     adopts sd-jwt-vc properly.
 */

import { randomBytes, createPrivateKey, createPublicKey } from 'crypto'

import { SignJWT, jwtVerify } from 'jose'

import { canonicalHash } from '../jcs'
import type { KeyPair } from '../did'
import type { CartMandate } from '../mandates'
import type { PaymentItem, PaymentResponse } from './payment-request'

// ─── Constants ───────────────────────────────────────────────────

export const PAYMENT_MANDATE_DATA_KEY = 'ap2.mandates.PaymentMandate'

/**
 * Mandate TTL in seconds. Matches CartMandate's 10-minute window so a
 * mandate set signed-then-paid in one demo session won't run out of
 * time within the recording.
 */
const PAYMENT_MANDATE_TTL_SECONDS = 600

// ─── Spec types — v0.2-canonical ──────────────────────────────────

/**
 * Project extension — not in the canonical Pydantic but required by
 * AP2 §4.1.3 ("AI Agent presence and transaction modality (Human Present
 * v/s Not Present) signals must always be shared").
 *
 * Lives inside `PaymentMandateContents` under an `agent_presence` field.
 * The project namespace prefix `x_` flags it as an extension.
 */
export interface AgentPresence {
  /** Always true on this platform — every transaction goes through ACG. */
  agent_involved: boolean
  /**
   * True when the user is actively in the conversation at sign time
   * (chat-widget or Claude Desktop session). False for autonomous flows
   * (post-demo IntentMandate path).
   */
  human_present: boolean
}

/**
 * v0.2-canonical PaymentMandateContents.
 *
 * Field names match the Pydantic class exactly. The only addition is
 * `x_agent_presence` (project extension) — see `AgentPresence`.
 */
export interface PaymentMandateContents {
  /** Unique identifier for this payment mandate. Format: `pm-<16 hex>`. */
  payment_mandate_id: string
  /** Unique identifier for the linked PaymentRequest (= CartMandate id). */
  payment_details_id: string
  payment_details_total: PaymentItem
  payment_response: PaymentResponse
  /** Identifier for the merchant. Typically the merchant DID. */
  merchant_agent: string
  /** ISO 8601 timestamp at sign time. */
  timestamp: string
  /** Project extension — see `AgentPresence`. */
  x_agent_presence: AgentPresence
}

/**
 * v0.2-canonical PaymentMandate — `{ contents, user_authorization }`.
 *
 * Same shape as `CartMandate`'s `{ contents, merchant_authorization }`
 * but signed by a Credentials Provider (not the merchant).
 */
export interface PaymentMandate {
  payment_mandate_contents: PaymentMandateContents
  user_authorization: string // Ed25519 JWS (see deviation note above)
}

// ─── JWT payload claims ──────────────────────────────────────────

/**
 * Claims carried in the `user_authorization` JWT.
 *
 * `transaction_data` is the AP2-specific binding: SHA-256 hashes of
 * `[CartMandate, PaymentMandateContents]` in order. A network verifying
 * the chain recomputes both hashes and compares against this array.
 */
export interface PaymentMandateJWTPayload {
  iss: string // CP DID
  sub: string // payment_mandate_id
  aud: string // "ap2"
  iat: number
  exp: number
  jti: string
  transaction_data: [string, string] // [hash(CartMandate), hash(PaymentMandateContents)]
}

// ─── Verification result ─────────────────────────────────────────

export interface PaymentMandateVerification {
  valid: boolean
  checks: {
    signatureValid: boolean
    notExpired: boolean
    transactionDataMatchesContents: boolean
  }
  payload?: PaymentMandateJWTPayload
  error?: string
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a CartMandate per the AP2 binding:
 *   hash = sha256(JCS(cartMandate))
 * Used to populate `transaction_data[0]` in `user_authorization`.
 */
export async function hashCartMandate(mandate: CartMandate): Promise<string> {
  return canonicalHash(mandate).hash
}

/**
 * Compute SHA-256 hash of PaymentMandateContents per the AP2 binding:
 *   hash = sha256(JCS(payment_mandate_contents))
 * Used to populate `transaction_data[1]` in `user_authorization`.
 */
export async function hashPaymentMandateContents(
  contents: PaymentMandateContents
): Promise<string> {
  return canonicalHash(contents).hash
}

// ─── Creation ────────────────────────────────────────────────────

export interface CreatePaymentMandateInput {
  /** The CartMandate this payment authorizes. Used for transaction_data binding. */
  cartMandate: CartMandate
  /** Total payment amount (must match cart total). */
  payment_details_total: PaymentItem
  /** Chosen payment method + opaque token. */
  payment_response: PaymentResponse
  /** Merchant identifier (typically the merchant DID). */
  merchant_agent: string
  /** Agent presence + transaction modality signals. */
  agent_presence: AgentPresence
}

export interface CreatePaymentMandateOptions {
  /** Issuer DID for the user_authorization JWT (the CP's DID). */
  cpDID: string
  /** Keypair the CP signs with. */
  cpKeys: KeyPair
  /** Audience claim (default "ap2"). */
  audience?: string
}

/**
 * Sign a PaymentMandate. The CP attests that the user authorized this
 * payment over the linked CartMandate.
 *
 * Steps:
 *   1. Build PaymentMandateContents
 *   2. Hash CartMandate + PaymentMandateContents
 *   3. Sign a JWT with `transaction_data: [cartHash, paymentHash]`
 *   4. Return `{ payment_mandate_contents, user_authorization }`
 */
export async function createPaymentMandate(
  input: CreatePaymentMandateInput,
  options: CreatePaymentMandateOptions
): Promise<PaymentMandate> {
  const paymentMandateId = generatePaymentMandateId()
  const now = Math.floor(Date.now() / 1000)
  const exp = now + PAYMENT_MANDATE_TTL_SECONDS
  const jti = randomBytes(16).toString('hex')
  const audience = options.audience ?? 'ap2'

  const contents: PaymentMandateContents = {
    payment_mandate_id: paymentMandateId,
    payment_details_id: input.cartMandate.contents.id,
    payment_details_total: input.payment_details_total,
    payment_response: input.payment_response,
    merchant_agent: input.merchant_agent,
    timestamp: new Date(now * 1000).toISOString(),
    x_agent_presence: input.agent_presence,
  }

  const cartHash = await hashCartMandate(input.cartMandate)
  const contentsHash = await hashPaymentMandateContents(contents)

  const privateKeyObject = createPrivateKey({
    key: options.cpKeys.privateKey,
    format: 'der',
    type: 'pkcs8',
  })

  const userAuthorization = await new SignJWT({
    transaction_data: [cartHash, contentsHash],
  })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(options.cpDID)
    .setSubject(paymentMandateId)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(privateKeyObject)

  return {
    payment_mandate_contents: contents,
    user_authorization: userAuthorization,
  }
}

// ─── Verification ────────────────────────────────────────────────

/**
 * Verify a PaymentMandate against the CP's public key.
 *
 * Checks performed:
 *   - JWT signature valid against `cpPublicKey`
 *   - JWT not expired
 *   - transaction_data[1] matches recomputed hash of contents
 *
 * NOTE: `transaction_data[0]` (CartMandate hash) is NOT checked here —
 * the caller (typically a payment network) must independently fetch the
 * CartMandate and verify it against `transaction_data[0]`. See the
 * `MockPaymentNetwork.approvePayment` implementation for the full chain.
 */
export async function verifyPaymentMandate(
  mandate: PaymentMandate,
  cpPublicKey: Buffer
): Promise<PaymentMandateVerification> {
  if (
    !mandate?.user_authorization ||
    typeof mandate.user_authorization !== 'string'
  ) {
    return {
      valid: false,
      checks: {
        signatureValid: false,
        notExpired: false,
        transactionDataMatchesContents: false,
      },
      error: 'malformed PaymentMandate (missing user_authorization)',
    }
  }

  let payload: PaymentMandateJWTPayload

  try {
    const publicKeyObject = createPublicKey({
      key: cpPublicKey,
      format: 'der',
      type: 'spki',
    })

    const verified = await jwtVerify(
      mandate.user_authorization,
      publicKeyObject
    )

    payload = (verified.payload as unknown) as PaymentMandateJWTPayload
  } catch (err) {
    return {
      valid: false,
      checks: {
        signatureValid: false,
        notExpired: false,
        transactionDataMatchesContents: false,
      },
      error:
        err instanceof Error ? err.message : 'signature verification failed',
    }
  }

  const now = Math.floor(Date.now() / 1000)
  const notExpired = payload.exp > now

  const expectedContentsHash = await hashPaymentMandateContents(
    mandate.payment_mandate_contents
  )

  const transactionDataMatchesContents =
    Array.isArray(payload.transaction_data) &&
    payload.transaction_data.length === 2 &&
    payload.transaction_data[1] === expectedContentsHash

  const valid = notExpired && transactionDataMatchesContents

  return {
    valid,
    checks: {
      signatureValid: true,
      notExpired,
      transactionDataMatchesContents,
    },
    payload,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function generatePaymentMandateId(): string {
  return `pm-${randomBytes(8).toString('hex')}`
}
