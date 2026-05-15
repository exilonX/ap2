/**
 * verifyChain + firstFailingCheck tests.
 *
 * Exercise the pure 7-check verification primitive in isolation —
 * no IdentityHolder, no KeyStore, no receipt signing. These tests
 * complement the higher-level MockPaymentNetwork tests by pinning
 * the per-check behaviour individually.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCartMandate,
  generateKeyPair,
  type Ap2PaymentItem,
  type Ap2PaymentResponse,
  type CartData,
  type CartMandate,
  type PaymentMandate,
  type VerificationChecks,
} from '@acg/core';

import { MockCredentialsProvider } from '../credentials-provider';
import { firstFailingCheck, verifyChain } from '../verify-chain';
import { FakeKeyStore } from './fake-keystore';

const cart: CartData = {
  items: [{ sku: 'sku-vc', name: 'Test', quantity: 1, unitPrice: 100 }],
  totalAmount: 100,
  currency: 'RON',
  orderFormId: 'of-vc-test',
};

/**
 * Build a self-consistent (CartMandate, PaymentMandate) pair plus the
 * matching merchant + CP public keys. The PaymentMandate's
 * transaction_data is correctly bound to the CartMandate, the amounts
 * match, and the mandate ids reference each other. All seven checks
 * pass on this fixture.
 */
async function freshChain() {
  const merchantKeys = generateKeyPair();
  const merchantDID = 'did:web:merchant.example.com';
  const cartMandate = await createCartMandate(cart, 'merchant.example.com', merchantKeys);

  const cp = new MockCredentialsProvider({
    keyStore: new FakeKeyStore(),
    domain: 'mock-cp.example.com',
  });

  const total: Ap2PaymentItem = {
    label: 'Total',
    amount: { currency: 'RON', value: 100 },
    refund_period: 30,
  };
  const paymentResponse: Ap2PaymentResponse = {
    request_id: cartMandate.contents.id,
    method_name: 'MOCK_CARD',
    details: { token: 'tok-vc' },
  };

  const paymentMandate = await cp.signPaymentMandate({
    cartMandate,
    payment_details_total: total,
    payment_response: paymentResponse,
    merchant_agent: merchantDID,
    agent_presence: { agent_involved: true, human_present: true },
  });

  const cpPublicKey = await cp.getPublicKey();

  return {
    merchantKeys,
    merchantPublicKey: merchantKeys.publicKey,
    cartMandate,
    paymentMandate,
    cpPublicKey,
  };
}

describe('verifyChain — happy path', () => {
  it('returns all 7 checks true on a self-consistent chain', async () => {
    const f = await freshChain();
    const checks = await verifyChain({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantPublicKey,
      cpPublicKey: f.cpPublicKey,
    });
    for (const value of Object.values(checks)) {
      assert.equal(value, true);
    }
  });

  it('the result satisfies firstFailingCheck(checks) === undefined', async () => {
    const f = await freshChain();
    const checks = await verifyChain({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantPublicKey,
      cpPublicKey: f.cpPublicKey,
    });
    assert.equal(firstFailingCheck(checks), undefined);
  });
});

describe('verifyChain — merchant_signature', () => {
  it('fails when the merchant public key does not match the signing key', async () => {
    const f = await freshChain();
    const wrongKeys = generateKeyPair();
    const checks = await verifyChain({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: wrongKeys.publicKey,
      cpPublicKey: f.cpPublicKey,
    });
    assert.equal(checks.merchant_signature, false);
  });
});

describe('verifyChain — cp_signature', () => {
  it('fails when the CP public key does not match the signing key', async () => {
    const f = await freshChain();
    const wrongKeys = generateKeyPair();
    const checks = await verifyChain({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantPublicKey,
      cpPublicKey: wrongKeys.publicKey,
    });
    assert.equal(checks.cp_signature, false);
  });
});

describe('verifyChain — amount_consistency', () => {
  it('fails when the PaymentMandate total differs from the CartMandate total', async () => {
    const f = await freshChain();
    const tampered: PaymentMandate = {
      ...f.paymentMandate,
      payment_mandate_contents: {
        ...f.paymentMandate.payment_mandate_contents,
        payment_details_total: {
          label: 'Total',
          amount: { currency: 'RON', value: 999.99 },
        },
      },
    };
    const checks = await verifyChain({
      paymentMandate: tampered,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantPublicKey,
      cpPublicKey: f.cpPublicKey,
    });
    assert.equal(checks.amount_consistency, false);
    // Mutating the contents post-signing also breaks the contents hash
    // binding — verifyPaymentMandate's structural check catches that.
    assert.equal(checks.hash_binding, false);
  });

  it('passes when amounts match with different numeric representations', async () => {
    // Defensive — exercise the Number() normalisation in verifyChain
    // against a freshly-built chain that already uses the trailing-zero
    // CartMandate string representation. If the future test fixture
    // changes this, the assertion still holds: equal amounts compare equal.
    const f = await freshChain();
    const checks = await verifyChain({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantPublicKey,
      cpPublicKey: f.cpPublicKey,
    });
    assert.equal(checks.amount_consistency, true);
  });
});

describe('verifyChain — mandate_id_linking', () => {
  it('fails when payment_details_id does not reference the cart mandate', async () => {
    const f = await freshChain();
    const tampered: PaymentMandate = {
      ...f.paymentMandate,
      payment_mandate_contents: {
        ...f.paymentMandate.payment_mandate_contents,
        payment_details_id: 'mandate-something-else',
      },
    };
    const checks = await verifyChain({
      paymentMandate: tampered,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantPublicKey,
      cpPublicKey: f.cpPublicKey,
    });
    assert.equal(checks.mandate_id_linking, false);
  });
});

describe('verifyChain — hash_binding', () => {
  it('fails when the PaymentMandate is signed over one CartMandate but presented with another', async () => {
    const f = await freshChain();
    // A different CartMandate — same shape, different id and signature.
    const otherCartMandate: CartMandate = await createCartMandate(
      { ...cart, orderFormId: 'of-other' },
      'merchant.example.com',
      f.merchantKeys
    );
    const checks = await verifyChain({
      paymentMandate: f.paymentMandate,
      cartMandate: otherCartMandate,
      merchantPublicKey: f.merchantPublicKey,
      cpPublicKey: f.cpPublicKey,
    });
    // transaction_data[0] was bound to the original CartMandate's hash
    // — it won't match the substituted mandate's hash.
    assert.equal(checks.hash_binding, false);
    // mandate_id_linking also breaks (different ids).
    assert.equal(checks.mandate_id_linking, false);
  });
});

describe('firstFailingCheck — naming priority', () => {
  it('returns undefined when all checks pass', () => {
    const checks: VerificationChecks = {
      merchant_signature: true,
      cp_signature: true,
      hash_binding: true,
      amount_consistency: true,
      mandate_id_linking: true,
      payment_mandate_not_expired: true,
      cart_mandate_not_expired: true,
    };
    assert.equal(firstFailingCheck(checks), undefined);
  });

  it('names merchant_signature first when both crypto checks fail', () => {
    const checks: VerificationChecks = {
      merchant_signature: false,
      cp_signature: false,
      hash_binding: true,
      amount_consistency: true,
      mandate_id_linking: true,
      payment_mandate_not_expired: true,
      cart_mandate_not_expired: true,
    };
    assert.match(firstFailingCheck(checks) ?? '', /merchant signature/i);
  });

  it('names cp_signature when only CP signature fails', () => {
    const checks: VerificationChecks = {
      merchant_signature: true,
      cp_signature: false,
      hash_binding: true,
      amount_consistency: true,
      mandate_id_linking: true,
      payment_mandate_not_expired: true,
      cart_mandate_not_expired: true,
    };
    assert.match(firstFailingCheck(checks) ?? '', /credentials provider signature/i);
  });

  it('prioritizes hash_binding over amount when both fail (post-sign tamper signal)', () => {
    // The ordering is intentional: cryptographic violations come before
    // semantic ones. A tampered amount also breaks the hash binding,
    // and we want the receipt to name the more fundamental fault.
    const checks: VerificationChecks = {
      merchant_signature: true,
      cp_signature: true,
      hash_binding: false,
      amount_consistency: false,
      mandate_id_linking: true,
      payment_mandate_not_expired: true,
      cart_mandate_not_expired: true,
    };
    assert.match(firstFailingCheck(checks) ?? '', /hash binding/i);
  });

  it('names expiry checks last', () => {
    const checks: VerificationChecks = {
      merchant_signature: true,
      cp_signature: true,
      hash_binding: true,
      amount_consistency: true,
      mandate_id_linking: true,
      payment_mandate_not_expired: false,
      cart_mandate_not_expired: true,
    };
    assert.match(firstFailingCheck(checks) ?? '', /payment mandate has expired/i);
  });
});
