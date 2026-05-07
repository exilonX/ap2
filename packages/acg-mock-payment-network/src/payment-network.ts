/**
 * MockPaymentNetwork
 *
 * Mock AP2 payment network for the demo. Plays the role of the
 * "network/issuer" — the party AP2 §4.1.3 says PaymentMandate flows to.
 * Verifies the full cryptographic chain (merchant signature, CP
 * signature, hash binding, amount consistency, mandate id linking,
 * expiry on both mandates) and emits a signed PaymentReceipt evidencing
 * the decision either way.
 *
 * Production swap-in: the real network is Visa / Mastercard / etc.
 * The interface here is the seam — replace the impl, keep the calling
 * code unchanged.
 */

import {
  createPaymentReceipt,
  hashCartMandate,
  hashPaymentMandateContents,
  loadOrCreateIdentity,
  verifyCartMandate,
  verifyPaymentMandate,
  type CartMandate,
  type DIDDocument,
  type KeyStore,
  type MerchantIdentity as Identity,
  type PaymentMandate,
  type PaymentReceipt,
  type VerificationChecks,
} from '@acg/core';

export interface MockPaymentNetworkDeps {
  /** KeyStore the network's keypair is persisted through. */
  keyStore: KeyStore;
  /** Domain for the network's DID (e.g. "mock-network.acg.example"). */
  domain: string;
}

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
   * iframe's "force reject" button to record the rejection branch of the
   * ceremony. The receipt is still genuinely signed; only the override
   * is theatrical. Production gating happens in the calling adapter —
   * this class trusts its caller.
   */
  forceFailCheck?: keyof VerificationChecks;
}

export class MockPaymentNetwork {
  private cached: Identity | null = null;

  constructor(private readonly deps: MockPaymentNetworkDeps) {}

  /** This network's DID (e.g. "did:web:mock-network.acg.example"). */
  public async getDID(): Promise<string> {
    return (await this.load()).did;
  }

  public async getDIDDocument(): Promise<DIDDocument> {
    return (await this.load()).didDocument;
  }

  public async getPublicKey(): Promise<Buffer> {
    return (await this.load()).keys.publicKey;
  }

  /**
   * Run the full AP2 verification chain on a payment authorization
   * request, then emit a signed PaymentReceipt — approved if all checks
   * pass, rejected otherwise. The receipt is always emitted (audit
   * trail), regardless of outcome.
   *
   * Seven checks are performed (matches `VerificationChecks` in
   * `@acg/core/ap2/payment-receipt`):
   *   1. CartMandate.merchant_authorization JWT signature
   *   2. PaymentMandate.user_authorization JWT signature
   *   3. transaction_data hash binding (both array entries)
   *   4. payment_details_total.amount == cart total
   *   5. payment_details_id == cartMandate.contents.id
   *   6. PaymentMandate not expired
   *   7. CartMandate not expired
   */
  public async approvePayment(input: ApprovePaymentInput): Promise<PaymentReceipt> {
    const identity = await this.load();
    const checks = await this.verifyChain(input);
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

  private async verifyChain(input: ApprovePaymentInput): Promise<VerificationChecks> {
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

  private async load(): Promise<Identity> {
    if (this.cached) return this.cached;
    this.cached = await loadOrCreateIdentity(this.deps.domain, this.deps.keyStore);
    return this.cached;
  }
}

/**
 * Return the name of the first failing check, or undefined if all
 * passed. Used for `rejection_reason`.
 */
function firstFailingCheck(checks: VerificationChecks): string | undefined {
  if (!checks.merchant_signature) return 'merchant signature invalid';
  if (!checks.cp_signature) return 'credentials provider signature invalid';
  if (!checks.hash_binding) return 'transaction_data hash binding mismatch';
  if (!checks.amount_consistency) return 'payment amount does not match cart total';
  if (!checks.mandate_id_linking) return 'payment_details_id does not reference cart mandate';
  if (!checks.payment_mandate_not_expired) return 'payment mandate has expired';
  if (!checks.cart_mandate_not_expired) return 'cart mandate has expired';
  return undefined;
}
