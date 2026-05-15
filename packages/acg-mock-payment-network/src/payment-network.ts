/**
 * MockPaymentNetwork
 *
 * Mock AP2 payment network for the demo. Plays the role of the
 * "network/issuer" — the party AP2 §4.1.3 says PaymentMandate flows to.
 *
 * The actual 7-check verification is delegated to `verifyChain` (in
 * `./verify-chain.ts`) — a pure function that's separately testable.
 * This class adds the identity-bearing wrapper: it borrows the network
 * keypair, applies any demo overrides, and signs the resulting
 * `PaymentReceipt`. The receipt is always emitted (audit trail),
 * regardless of outcome.
 *
 * Production swap-in: the real network is Visa / Mastercard / etc.
 * The interface here is the seam — replace the impl, keep the calling
 * code unchanged.
 */

import { IdentityHolder, createPaymentReceipt } from '@acg/core';
import type { PaymentReceipt } from '@acg/core';

import type { ApprovePaymentInput } from './types';
import { firstFailingCheck, verifyChain } from './verify-chain';

export class MockPaymentNetwork extends IdentityHolder {
  /**
   * Run the AP2 verification chain on a payment authorization request,
   * apply any demo `forceFailCheck` override, then emit a signed
   * `PaymentReceipt` — approved if all checks pass, rejected otherwise.
   *
   * The receipt is always emitted (always-emit invariant); on rejection
   * `rejection_reason` names the first failing check.
   */
  public async approvePayment(input: ApprovePaymentInput): Promise<PaymentReceipt> {
    const identity = await this.load();
    const checks = await verifyChain({
      paymentMandate: input.paymentMandate,
      cartMandate: input.cartMandate,
      merchantPublicKey: input.merchantPublicKey,
      cpPublicKey: input.cpPublicKey,
    });
    if (input.forceFailCheck) {
      checks[input.forceFailCheck] = false;
    }
    const rejectionReason = firstFailingCheck(checks);

    return createPaymentReceipt(
      {
        payment_mandate_id: input.paymentMandate.payment_mandate_contents.payment_mandate_id,
        cart_mandate_id: input.cartMandate.contents.id,
        merchant_did: input.merchantDID,
        cp_did: input.cpDID,
        amount: input.paymentMandate.payment_mandate_contents.payment_details_total.amount,
        agent_presence: input.paymentMandate.payment_mandate_contents.x_agent_presence,
        verification_checks: checks,
        rejection_reason: rejectionReason,
      },
      {
        networkDID: identity.did,
        networkKeys: identity.keys,
      }
    );
  }
}
