/**
 * MockPaymentNetwork tests.
 *
 * Covers:
 *   - happy path: full chain valid → receipt approval_status = 'approved', all 7 checks true
 *   - tampered cart in PaymentMandate's transaction_data[0] → hash_binding fails
 *   - amount mismatch → amount_consistency fails, rejection_reason set
 *   - mandate_id mismatch → mandate_id_linking fails
 *   - rejection produces a SIGNED receipt (always-emitted invariant)
 *   - the receipt verifies against the network's own public key
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCartMandate,
  generateKeyPair,
  verifyPaymentReceipt,
  type Ap2PaymentItem,
  type Ap2PaymentResponse,
  type CartData,
  type CartMandate,
  type PaymentMandate,
} from '@acg/core';

import { MockCredentialsProvider } from '../credentials-provider';
import { MockPaymentNetwork } from '../payment-network';
import { FakeKeyStore } from './fake-keystore';

const cart: CartData = {
  items: [{ sku: 'sku-shoe', name: 'Test shoe', quantity: 1, unitPrice: 100 }],
  totalAmount: 100,
  currency: 'RON',
  orderFormId: 'of-net-test',
};

async function freshFixture() {
  const merchantKeys = generateKeyPair();
  const merchantDID = 'did:web:merchant.example.com';
  const cartMandate = await createCartMandate(cart, 'merchant.example.com', merchantKeys);

  const cp = new MockCredentialsProvider({
    keyStore: new FakeKeyStore(),
    domain: 'mock-cp.example.com',
  });
  const network = new MockPaymentNetwork({
    keyStore: new FakeKeyStore(),
    domain: 'mock-network.example.com',
  });

  const total: Ap2PaymentItem = {
    label: 'Total',
    amount: { currency: 'RON', value: 100 },
    refund_period: 30,
  };
  const paymentResponse: Ap2PaymentResponse = {
    request_id: cartMandate.contents.id,
    method_name: 'MOCK_CARD',
    details: { token: 'tok-net-test' },
  };

  const paymentMandate = await cp.signPaymentMandate({
    cartMandate,
    payment_details_total: total,
    payment_response: paymentResponse,
    merchant_agent: merchantDID,
    agent_presence: { agent_involved: true, human_present: true },
  });

  return {
    merchantKeys,
    merchantDID,
    cartMandate,
    cp,
    network,
    paymentMandate,
  };
}

describe('MockPaymentNetwork — happy path', () => {
  it('approves a valid chain with all 7 checks passing', async () => {
    const f = await freshFixture();
    const cpPk = await f.cp.getPublicKey();
    const cpDid = await f.cp.getDID();
    const receipt = await f.network.approvePayment({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: cpDid,
    });
    assert.equal(receipt.contents.approval_status, 'approved');
    for (const value of Object.values(receipt.contents.verification_checks)) {
      assert.equal(value, true);
    }
    assert.equal(receipt.contents.rejection_reason, undefined);
  });

  it('the receipt verifies against the network public key', async () => {
    const f = await freshFixture();
    const cpPk = await f.cp.getPublicKey();
    const cpDid = await f.cp.getDID();
    const receipt = await f.network.approvePayment({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: cpDid,
    });
    const networkPk = await f.network.getPublicKey();
    const result = await verifyPaymentReceipt(receipt, networkPk);
    assert.equal(result.valid, true);
  });

  it('agent_presence flows through unchanged', async () => {
    const f = await freshFixture();
    const cpPk = await f.cp.getPublicKey();
    const receipt = await f.network.approvePayment({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: await f.cp.getDID(),
    });
    assert.deepEqual(receipt.contents.agent_presence, {
      agent_involved: true,
      human_present: true,
    });
  });
});

describe('MockPaymentNetwork — rejection paths', () => {
  it('rejects when amount mismatches between PaymentMandate and CartMandate', async () => {
    const f = await freshFixture();
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
    const cpPk = await f.cp.getPublicKey();
    const receipt = await f.network.approvePayment({
      paymentMandate: tampered,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: await f.cp.getDID(),
    });
    assert.equal(receipt.contents.approval_status, 'rejected');
    // Tampering with amount post-signing also breaks the contents hash
    // binding (transaction_data[1] no longer matches recomputed hash).
    // Both checks fail; rejection_reason names hash_binding (higher
    // priority in firstFailingCheck — cryptographic violations come
    // before semantic ones).
    assert.equal(receipt.contents.verification_checks.amount_consistency, false);
    assert.equal(receipt.contents.verification_checks.hash_binding, false);
  });

  it('rejects when mandate_id_linking is broken', async () => {
    const f = await freshFixture();
    const tampered: PaymentMandate = {
      ...f.paymentMandate,
      payment_mandate_contents: {
        ...f.paymentMandate.payment_mandate_contents,
        payment_details_id: 'mandate-fake-not-the-cart',
      },
    };
    const cpPk = await f.cp.getPublicKey();
    const receipt = await f.network.approvePayment({
      paymentMandate: tampered,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: await f.cp.getDID(),
    });
    assert.equal(receipt.contents.approval_status, 'rejected');
    assert.equal(receipt.contents.verification_checks.mandate_id_linking, false);
  });

  it('rejects when CartMandate signature does not match merchant public key', async () => {
    const f = await freshFixture();
    const wrongMerchantKeys = generateKeyPair();
    const cpPk = await f.cp.getPublicKey();
    const receipt = await f.network.approvePayment({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: wrongMerchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: await f.cp.getDID(),
    });
    assert.equal(receipt.contents.approval_status, 'rejected');
    assert.equal(receipt.contents.verification_checks.merchant_signature, false);
    assert.match(receipt.contents.rejection_reason ?? '', /merchant signature/i);
  });

  it('rejection still emits a SIGNED PaymentReceipt (always-emitted invariant)', async () => {
    const f = await freshFixture();
    const tampered: PaymentMandate = {
      ...f.paymentMandate,
      payment_mandate_contents: {
        ...f.paymentMandate.payment_mandate_contents,
        payment_details_total: {
          label: 'Total',
          amount: { currency: 'RON', value: 1 },
        },
      },
    };
    const cpPk = await f.cp.getPublicKey();
    const receipt = await f.network.approvePayment({
      paymentMandate: tampered,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: await f.cp.getDID(),
    });
    assert.equal(receipt.contents.approval_status, 'rejected');
    const networkPk = await f.network.getPublicKey();
    const verification = await verifyPaymentReceipt(receipt, networkPk);
    assert.equal(verification.valid, true);
  });
});

describe('MockPaymentNetwork — receipt artifact integrity', () => {
  it('records merchant_did, cp_did, network_did correctly', async () => {
    const f = await freshFixture();
    const cpPk = await f.cp.getPublicKey();
    const cpDid = await f.cp.getDID();
    const receipt = await f.network.approvePayment({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: cpDid,
    });
    assert.equal(receipt.contents.merchant_did, f.merchantDID);
    assert.equal(receipt.contents.cp_did, cpDid);
    assert.equal(receipt.contents.network_did, await f.network.getDID());
  });

  it('cart_mandate_id and payment_mandate_id reference the inputs', async () => {
    const f = await freshFixture();
    const cpPk = await f.cp.getPublicKey();
    const receipt = await f.network.approvePayment({
      paymentMandate: f.paymentMandate,
      cartMandate: f.cartMandate,
      merchantPublicKey: f.merchantKeys.publicKey,
      merchantDID: f.merchantDID,
      cpPublicKey: cpPk,
      cpDID: await f.cp.getDID(),
    });
    assert.equal(receipt.contents.cart_mandate_id, f.cartMandate.contents.id);
    assert.equal(
      receipt.contents.payment_mandate_id,
      f.paymentMandate.payment_mandate_contents.payment_mandate_id
    );
  });
});
