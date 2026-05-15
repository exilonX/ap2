/**
 * Pure 7-check AP2 verification chain.
 *
 * Extracted from `MockPaymentNetwork.approvePayment` so the chain can
 * be tested in isolation (no `IdentityHolder`, no `KeyStore` setup)
 * and so the network class shrinks to identity + receipt issuance.
 *
 * The seven checks match `VerificationChecks` in `@acg/core/ap2/payment-receipt`:
 *
 *   1. CartMandate.merchant_authorization JWT signature
 *   2. PaymentMandate.user_authorization JWT signature
 *   3. transaction_data hash binding (both array entries)
 *   4. payment_details_total.amount == cart total
 *   5. payment_details_id == cartMandate.contents.id
 *   6. PaymentMandate not expired
 *   7. CartMandate not expired
 *
 * All inputs and outputs are pure data. Callers compose this with
 * their own identity / receipt-signing surface.
 */

import {
  hashCartMandate,
  hashPaymentMandateContents,
  verifyCartMandate,
  verifyPaymentMandate,
} from '@acg/core';
import type { VerificationChecks } from '@acg/core';

import type { VerifyChainInput } from './types';

/**
 * Run the 7-check verification chain. Returns the structured result
 * with one boolean per check — caller decides whether to fail or
 * approve (and whether to apply demo overrides).
 */
export async function verifyChain(input: VerifyChainInput): Promise<VerificationChecks> {
  // 1 + 7. CartMandate signature + expiry
  const cartVerification = await verifyCartMandate(input.cartMandate, input.merchantPublicKey);

  // 2 + 6. PaymentMandate signature + expiry + hash binding for contents
  const paymentVerification = await verifyPaymentMandate(input.paymentMandate, input.cpPublicKey);

  // 3. Full hash binding — verifyPaymentMandate already checks the
  //    contents hash (transaction_data[1]); we additionally check
  //    transaction_data[0] against hash(CartMandate).
  const expectedCartHash = await hashCartMandate(input.cartMandate);
  const expectedContentsHash = await hashPaymentMandateContents(
    input.paymentMandate.payment_mandate_contents
  );
  const td = paymentVerification.payload?.transaction_data;
  const hashBinding =
    Array.isArray(td) &&
    td.length === 2 &&
    td[0] === expectedCartHash &&
    td[1] === expectedContentsHash;

  // 4. Amount consistency — PaymentMandate's total must equal CartMandate's total.
  //
  // Representation note: CartMandate.contents.total.value is a string
  // (`.toFixed(2)`, our pre-W3C shape's choice — see Q3/Y deviation in
  // ISSUES.md). PaymentMandate.payment_details_total.amount.value is a
  // number (canonical AP2 v0.2 / Google Pydantic uses float). Normalize
  // both via Number(...) before comparison so neither representation
  // drift nor trailing zeros cause false rejections.
  const paymentTotal = input.paymentMandate.payment_mandate_contents.payment_details_total.amount;
  const cartTotal = input.cartMandate.contents.total;
  const amountConsistency =
    paymentTotal.currency === cartTotal.currency &&
    Number(paymentTotal.value) === Number(cartTotal.value);

  // 5. Mandate id linking.
  const mandateIdLinking =
    input.paymentMandate.payment_mandate_contents.payment_details_id ===
    input.cartMandate.contents.id;

  return {
    merchant_signature: cartVerification.checks.signatureValid,
    cp_signature: paymentVerification.checks.signatureValid,
    hash_binding: hashBinding,
    amount_consistency: amountConsistency,
    mandate_id_linking: mandateIdLinking,
    payment_mandate_not_expired: paymentVerification.checks.notExpired,
    cart_mandate_not_expired: cartVerification.checks.notExpired,
  };
}

/**
 * Return the name of the first failing check, or undefined if all
 * passed. Used to populate `PaymentReceipt.rejection_reason`.
 *
 * Ordered intentionally — cryptographic violations (bad signatures,
 * broken hash binding) come before semantic ones (amount, mandate-id
 * linking) so a tampered chain is named as such rather than as a
 * downstream consequence.
 */
export function firstFailingCheck(checks: VerificationChecks): string | undefined {
  if (!checks.merchant_signature) return 'merchant signature invalid';
  if (!checks.cp_signature) return 'credentials provider signature invalid';
  if (!checks.hash_binding) return 'transaction_data hash binding mismatch';
  if (!checks.amount_consistency) return 'payment amount does not match cart total';
  if (!checks.mandate_id_linking) return 'payment_details_id does not reference cart mandate';
  if (!checks.payment_mandate_not_expired) return 'payment mandate has expired';
  if (!checks.cart_mandate_not_expired) return 'cart mandate has expired';
  return undefined;
}
