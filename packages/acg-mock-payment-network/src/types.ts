/**
 * Shared interfaces for `@acg/mock-payment-network`.
 *
 * Single home for the role-class input shapes so changes to a wire
 * contract don't ripple through implementation files.
 */

import type {
  AgentPresence,
  Ap2PaymentItem,
  Ap2PaymentResponse,
  CartMandate,
  PaymentMandate,
  VerificationChecks,
} from '@acg/core';

// ─── MockCredentialsProvider ────────────────────────────────────────

export interface SignPaymentMandateInput {
  cartMandate: CartMandate;
  payment_details_total: Ap2PaymentItem;
  payment_response: Ap2PaymentResponse;
  /** Merchant DID — populated as `merchant_agent` in the contents. */
  merchant_agent: string;
  agent_presence: AgentPresence;
}

// ─── MockPaymentNetwork ─────────────────────────────────────────────

export interface ApprovePaymentInput {
  paymentMandate: PaymentMandate;
  cartMandate: CartMandate;
  /** Merchant's public key for verifying CartMandate.merchant_authorization. */
  merchantPublicKey: Buffer;
  /** Merchant's DID — recorded into the receipt. */
  merchantDID: string;
  /** CP's public key for verifying PaymentMandate.user_authorization. */
  cpPublicKey: Buffer;
  /** CP's DID — recorded into the receipt. */
  cpDID: string;
  /**
   * Demo-only — force a specific check to fail without constructing an
   * actually-invalid mandate or waiting for natural expiry. Used by the
   * iframe's "force reject" button to record the rejection branch of
   * the ceremony. The receipt is still genuinely signed; only the
   * override is theatrical. Production gating happens in the calling
   * adapter — this class trusts its caller.
   */
  forceFailCheck?: keyof VerificationChecks;
}

// ─── verifyChain (pure 7-check verifier — see ./verify-chain.ts) ────

/**
 * Slimmer input to the pure `verifyChain` function — the DIDs and
 * `forceFailCheck` aren't part of the cryptographic check, they only
 * surface in the resulting receipt.
 */
export interface VerifyChainInput {
  paymentMandate: PaymentMandate;
  cartMandate: CartMandate;
  merchantPublicKey: Buffer;
  cpPublicKey: Buffer;
}
