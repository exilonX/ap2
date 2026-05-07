/**
 * PaymentMandate tests.
 *
 * Covers:
 *   - sign-then-verify round-trip (transaction_data[1] hash matches contents)
 *   - tamper detection on PaymentMandateContents (hash mismatch)
 *   - signature verification against wrong key fails
 *   - JWT structure: iss = CP DID, sub = paymentMandateId, exp ~10 min out
 *   - transaction_data[0] is hash(CartMandate) — recoverable for network use
 *   - x_agent_presence is preserved through the round-trip
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPaymentMandate,
  verifyPaymentMandate,
  hashCartMandate,
  hashPaymentMandateContents,
  type PaymentMandate,
} from './payment-mandate';
import { generateKeyPair, didFromDomain } from '../did';
import {
  createCartMandate,
  type CartData,
  type CartMandate,
} from '../mandates';
import type { PaymentItem, PaymentResponse } from './payment-request';

const cartData: CartData = {
  items: [{ sku: 'sku-1', name: 'Test product', quantity: 1, unitPrice: 99.99 }],
  totalAmount: 99.99,
  currency: 'RON',
  orderFormId: 'of-pmt-test',
};

async function freshFixture() {
  const merchantKeys = generateKeyPair();
  const merchantDomain = 'merchant.example.com';
  const cartMandate = await createCartMandate(cartData, merchantDomain, merchantKeys);

  const cpKeys = generateKeyPair();
  const cpDID = didFromDomain('cp.example.com');

  const total: PaymentItem = {
    label: 'Total',
    amount: { currency: 'RON', value: 99.99 },
    refund_period: 30,
  };
  const paymentResponse: PaymentResponse = {
    request_id: cartMandate.contents.id,
    method_name: 'MOCK_CARD',
    details: { token: 'mock-tok-abc123' },
  };

  return { merchantKeys, merchantDomain, cartMandate, cpKeys, cpDID, total, paymentResponse };
}

describe('PaymentMandate — sign + verify round-trip', () => {
  it('signs and verifies cleanly', async () => {
    const f = await freshFixture();
    const pm = await createPaymentMandate(
      {
        cartMandate: f.cartMandate,
        payment_details_total: f.total,
        payment_response: f.paymentResponse,
        merchant_agent: didFromDomain(f.merchantDomain),
        agent_presence: { agent_involved: true, human_present: true },
      },
      { cpDID: f.cpDID, cpKeys: f.cpKeys }
    );

    const result = await verifyPaymentMandate(pm, f.cpKeys.publicKey);
    assert.equal(result.valid, true);
    assert.equal(result.checks.signatureValid, true);
    assert.equal(result.checks.notExpired, true);
    assert.equal(result.checks.transactionDataMatchesContents, true);
  });

  it('persists x_agent_presence in contents', async () => {
    const f = await freshFixture();
    const pm = await createPaymentMandate(
      {
        cartMandate: f.cartMandate,
        payment_details_total: f.total,
        payment_response: f.paymentResponse,
        merchant_agent: didFromDomain(f.merchantDomain),
        agent_presence: { agent_involved: true, human_present: false },
      },
      { cpDID: f.cpDID, cpKeys: f.cpKeys }
    );

    assert.deepEqual(pm.payment_mandate_contents.x_agent_presence, {
      agent_involved: true,
      human_present: false,
    });
  });

  it('JWT iss/sub/exp/jti are populated correctly', async () => {
    const f = await freshFixture();
    const pm = await createPaymentMandate(
      {
        cartMandate: f.cartMandate,
        payment_details_total: f.total,
        payment_response: f.paymentResponse,
        merchant_agent: didFromDomain(f.merchantDomain),
        agent_presence: { agent_involved: true, human_present: true },
      },
      { cpDID: f.cpDID, cpKeys: f.cpKeys }
    );

    const result = await verifyPaymentMandate(pm, f.cpKeys.publicKey);
    assert.ok(result.payload);
    assert.equal(result.payload!.iss, f.cpDID);
    assert.equal(result.payload!.sub, pm.payment_mandate_contents.payment_mandate_id);
    assert.ok(result.payload!.jti);
    assert.ok(result.payload!.exp > result.payload!.iat);
  });
});

describe('PaymentMandate — transaction_data binding', () => {
  it('transaction_data[0] equals hash(CartMandate)', async () => {
    const f = await freshFixture();
    const pm = await createPaymentMandate(
      {
        cartMandate: f.cartMandate,
        payment_details_total: f.total,
        payment_response: f.paymentResponse,
        merchant_agent: didFromDomain(f.merchantDomain),
        agent_presence: { agent_involved: true, human_present: true },
      },
      { cpDID: f.cpDID, cpKeys: f.cpKeys }
    );

    const result = await verifyPaymentMandate(pm, f.cpKeys.publicKey);
    assert.ok(result.payload);
    const expectedCartHash = await hashCartMandate(f.cartMandate);
    assert.equal(result.payload!.transaction_data[0], expectedCartHash);
  });

  it('transaction_data[1] equals hash(PaymentMandateContents)', async () => {
    const f = await freshFixture();
    const pm = await createPaymentMandate(
      {
        cartMandate: f.cartMandate,
        payment_details_total: f.total,
        payment_response: f.paymentResponse,
        merchant_agent: didFromDomain(f.merchantDomain),
        agent_presence: { agent_involved: true, human_present: true },
      },
      { cpDID: f.cpDID, cpKeys: f.cpKeys }
    );

    const result = await verifyPaymentMandate(pm, f.cpKeys.publicKey);
    assert.ok(result.payload);
    const expectedContentsHash = await hashPaymentMandateContents(pm.payment_mandate_contents);
    assert.equal(result.payload!.transaction_data[1], expectedContentsHash);
  });
});

describe('PaymentMandate — tamper + key mismatch', () => {
  it('detects tampering of payment_mandate_contents (hash mismatch)', async () => {
    const f = await freshFixture();
    const pm = await createPaymentMandate(
      {
        cartMandate: f.cartMandate,
        payment_details_total: f.total,
        payment_response: f.paymentResponse,
        merchant_agent: didFromDomain(f.merchantDomain),
        agent_presence: { agent_involved: true, human_present: true },
      },
      { cpDID: f.cpDID, cpKeys: f.cpKeys }
    );

    const tampered: PaymentMandate = {
      ...pm,
      payment_mandate_contents: {
        ...pm.payment_mandate_contents,
        merchant_agent: 'attacker-did',
      },
    };

    const result = await verifyPaymentMandate(tampered, f.cpKeys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, true); // signature itself still valid (over original contents)
    assert.equal(result.checks.transactionDataMatchesContents, false);
  });

  it('rejects verification under wrong CP public key', async () => {
    const f = await freshFixture();
    const pm = await createPaymentMandate(
      {
        cartMandate: f.cartMandate,
        payment_details_total: f.total,
        payment_response: f.paymentResponse,
        merchant_agent: didFromDomain(f.merchantDomain),
        agent_presence: { agent_involved: true, human_present: true },
      },
      { cpDID: f.cpDID, cpKeys: f.cpKeys }
    );

    const otherKeys = generateKeyPair();
    const result = await verifyPaymentMandate(pm, otherKeys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, false);
  });

  it('rejects malformed PaymentMandate (missing user_authorization)', async () => {
    const f = await freshFixture();
    const malformed = { payment_mandate_contents: {} as never } as never as PaymentMandate;
    const result = await verifyPaymentMandate(malformed, f.cpKeys.publicKey);
    assert.equal(result.valid, false);
    assert.match(result.error ?? '', /malformed/i);
  });
});
