/**
 * MockCredentialsProvider
 *
 * Mock AP2 Credentials Provider for the demo. Plays the role of "the
 * party that holds the user's payment instruments and signs PaymentMandate
 * on the user's behalf." Extends `IdentityHolder` from `@acg/core` to
 * inherit the DID + public-key accessors and the lazy `load()` helper;
 * adds the single CP-specific method: `signPaymentMandate`.
 *
 * Production swap-in: the real CP would be a separate service the
 * Adapter calls (Google Pay / wallet / issuer-tokenized credentials).
 * The interface here is the seam — replace the impl, keep the calling
 * code unchanged.
 *
 * Deviation from AP2 v0.2 spec (documented in AP2_COMPLIANCE.md):
 *   - user_authorization is an Ed25519 JWS, not a full sd-jwt-vc with
 *     KB-JWT. The cryptographic content (signature over transaction_data)
 *     is equivalent. v1.x post-demo work adopts sd-jwt-vc properly.
 */

import {
  IdentityHolder,
  createPaymentMandate,
  type AgentPresence,
  type Ap2PaymentItem,
  type Ap2PaymentResponse,
  type CartMandate,
  type PaymentMandate,
} from '@acg/core';

export interface SignPaymentMandateInput {
  cartMandate: CartMandate;
  payment_details_total: Ap2PaymentItem;
  payment_response: Ap2PaymentResponse;
  /** Merchant DID — populated as `merchant_agent` in the contents. */
  merchant_agent: string;
  agent_presence: AgentPresence;
}

export class MockCredentialsProvider extends IdentityHolder {
  /**
   * Sign a PaymentMandate on the user's behalf. The CP attests that
   * the user authorized this payment over the linked CartMandate. The
   * `transaction_data` claim cryptographically binds the two artifacts.
   *
   * Production CP would require a real user-device tap-confirm before
   * signing. This mock signs unconditionally — the demo's recording
   * narrative is still honest because the `agent_presence` flags travel
   * through, and the case study calls out the simplification.
   */
  public async signPaymentMandate(input: SignPaymentMandateInput): Promise<PaymentMandate> {
    const identity = await this.load();
    return createPaymentMandate(input, {
      cpDID: identity.did,
      cpKeys: identity.keys,
    });
  }
}
