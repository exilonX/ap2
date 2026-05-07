/**
 * MockCredentialsProvider tests.
 *
 * Covers:
 *   - getDID + getDIDDocument round-trip (load-or-create on first read)
 *   - signPaymentMandate produces a verifiable mandate against the CP's own key
 *   - the produced PaymentMandate carries x_agent_presence + payment_response unchanged
 *   - calling signPaymentMandate twice returns mandates signed by the SAME DID
 *     (load-or-create caches; identity persists across calls)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCartMandate,
  generateKeyPair,
  verifyPaymentMandate,
  type Ap2PaymentItem,
  type Ap2PaymentResponse,
  type CartData,
} from '@acg/core';

import { MockCredentialsProvider } from '../credentials-provider';
import { FakeKeyStore } from './fake-keystore';

const cart: CartData = {
  items: [{ sku: 'sku-1', name: 'Test', quantity: 1, unitPrice: 50 }],
  totalAmount: 50,
  currency: 'RON',
  orderFormId: 'of-cp-test',
};

async function freshFixture() {
  const merchantKeys = generateKeyPair();
  const cartMandate = await createCartMandate(cart, 'merchant.example.com', merchantKeys);

  const cp = new MockCredentialsProvider({
    keyStore: new FakeKeyStore(),
    domain: 'mock-cp.example.com',
  });

  const total: Ap2PaymentItem = {
    label: 'Total',
    amount: { currency: 'RON', value: 50 },
    refund_period: 30,
  };
  const paymentResponse: Ap2PaymentResponse = {
    request_id: cartMandate.contents.id,
    method_name: 'MOCK_CARD',
    details: { token: 'tok-test' },
  };

  return { merchantKeys, cartMandate, cp, total, paymentResponse };
}

describe('MockCredentialsProvider — identity', () => {
  it('getDID returns did:web:{domain}', async () => {
    const cp = new MockCredentialsProvider({
      keyStore: new FakeKeyStore(),
      domain: 'mock-cp.example.com',
    });
    assert.equal(await cp.getDID(), 'did:web:mock-cp.example.com');
  });

  it('getDIDDocument returns a well-formed document with the CP public key', async () => {
    const cp = new MockCredentialsProvider({
      keyStore: new FakeKeyStore(),
      domain: 'mock-cp.example.com',
    });
    const doc = await cp.getDIDDocument();
    assert.equal(doc.id, 'did:web:mock-cp.example.com');
    assert.equal(doc.verificationMethod[0].type, 'Ed25519VerificationKey2020');
  });

  it('keys persist across calls (load-or-create caches identity)', async () => {
    const cp = new MockCredentialsProvider({
      keyStore: new FakeKeyStore(),
      domain: 'mock-cp.example.com',
    });
    const did1 = await cp.getDID();
    const did2 = await cp.getDID();
    assert.equal(did1, did2);
  });
});

describe('MockCredentialsProvider — signPaymentMandate', () => {
  it('signs a PaymentMandate that verifies against the CP public key', async () => {
    const f = await freshFixture();
    const pm = await f.cp.signPaymentMandate({
      cartMandate: f.cartMandate,
      payment_details_total: f.total,
      payment_response: f.paymentResponse,
      merchant_agent: 'did:web:merchant.example.com',
      agent_presence: { agent_involved: true, human_present: true },
    });

    const cpPublicKey = await f.cp.getPublicKey();
    const result = await verifyPaymentMandate(pm, cpPublicKey);
    assert.equal(result.valid, true);
  });

  it('preserves agent_presence and payment_response in the signed mandate', async () => {
    const f = await freshFixture();
    const pm = await f.cp.signPaymentMandate({
      cartMandate: f.cartMandate,
      payment_details_total: f.total,
      payment_response: f.paymentResponse,
      merchant_agent: 'did:web:merchant.example.com',
      agent_presence: { agent_involved: true, human_present: false },
    });

    assert.deepEqual(pm.payment_mandate_contents.x_agent_presence, {
      agent_involved: true,
      human_present: false,
    });
    assert.deepEqual(pm.payment_mandate_contents.payment_response, f.paymentResponse);
  });

  it('two consecutive signs use the same CP DID', async () => {
    const f = await freshFixture();
    const pm1 = await f.cp.signPaymentMandate({
      cartMandate: f.cartMandate,
      payment_details_total: f.total,
      payment_response: f.paymentResponse,
      merchant_agent: 'did:web:merchant.example.com',
      agent_presence: { agent_involved: true, human_present: true },
    });
    const pm2 = await f.cp.signPaymentMandate({
      cartMandate: f.cartMandate,
      payment_details_total: f.total,
      payment_response: f.paymentResponse,
      merchant_agent: 'did:web:merchant.example.com',
      agent_presence: { agent_involved: true, human_present: true },
    });

    const cpPk = await f.cp.getPublicKey();
    assert.equal((await verifyPaymentMandate(pm1, cpPk)).payload?.iss, await f.cp.getDID());
    assert.equal((await verifyPaymentMandate(pm2, cpPk)).payload?.iss, await f.cp.getDID());
  });
});
