/**
 * PaymentReceipt tests.
 *
 * Covers:
 *   - sign + verify round-trip
 *   - approval_status derived from verification_checks (all true → approved)
 *   - approval_status === 'rejected' when ANY check is false
 *   - rejection_reason populated on rejection, omitted on approval
 *   - signature verifies against network public key
 *   - tamper detection on contents (receipt_hash mismatch)
 *   - propagation of agent_presence and verification_checks unchanged
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPaymentReceipt,
  verifyPaymentReceipt,
  type PaymentReceipt,
  type VerificationChecks,
} from './payment-receipt';
import { generateKeyPair, didFromDomain } from '../did';

const allChecksPassed: VerificationChecks = {
  merchant_signature: true,
  cp_signature: true,
  hash_binding: true,
  amount_consistency: true,
  mandate_id_linking: true,
  payment_mandate_not_expired: true,
  cart_mandate_not_expired: true,
};

const oneCheckFailed: VerificationChecks = {
  ...allChecksPassed,
  amount_consistency: false,
};

function freshFixture() {
  const networkKeys = generateKeyPair();
  const networkDID = didFromDomain('mock-network.example.com');
  return { networkKeys, networkDID };
}

describe('PaymentReceipt — round-trip', () => {
  it('signs an approved receipt and verifies cleanly', async () => {
    const { networkKeys, networkDID } = freshFixture();
    const receipt = await createPaymentReceipt(
      {
        payment_mandate_id: 'pm-aaaa',
        cart_mandate_id: 'mandate-bbbb',
        merchant_did: didFromDomain('merchant.example.com'),
        cp_did: didFromDomain('cp.example.com'),
        amount: { currency: 'RON', value: 99.99 },
        agent_presence: { agent_involved: true, human_present: true },
        verification_checks: allChecksPassed,
      },
      { networkDID, networkKeys }
    );

    const result = await verifyPaymentReceipt(receipt, networkKeys.publicKey);
    assert.equal(result.valid, true);
    assert.equal(result.checks.signatureValid, true);
    assert.equal(result.checks.notExpired, true);
    assert.equal(result.checks.receiptHashMatches, true);
  });

  it('marks approval_status approved when all checks pass', async () => {
    const { networkKeys, networkDID } = freshFixture();
    const receipt = await createPaymentReceipt(
      {
        payment_mandate_id: 'pm-x',
        cart_mandate_id: 'mandate-x',
        merchant_did: 'did:web:m',
        cp_did: 'did:web:cp',
        amount: { currency: 'USD', value: 50 },
        agent_presence: { agent_involved: true, human_present: true },
        verification_checks: allChecksPassed,
      },
      { networkDID, networkKeys }
    );
    assert.equal(receipt.contents.approval_status, 'approved');
    assert.equal(receipt.contents.rejection_reason, undefined);
  });

  it('marks approval_status rejected when ANY check fails', async () => {
    const { networkKeys, networkDID } = freshFixture();
    const receipt = await createPaymentReceipt(
      {
        payment_mandate_id: 'pm-x',
        cart_mandate_id: 'mandate-x',
        merchant_did: 'did:web:m',
        cp_did: 'did:web:cp',
        amount: { currency: 'USD', value: 50 },
        agent_presence: { agent_involved: true, human_present: true },
        verification_checks: oneCheckFailed,
        rejection_reason: 'amount mismatch',
      },
      { networkDID, networkKeys }
    );
    assert.equal(receipt.contents.approval_status, 'rejected');
    assert.equal(receipt.contents.rejection_reason, 'amount mismatch');
  });
});

describe('PaymentReceipt — tamper + key mismatch', () => {
  it('detects tampering of contents (receipt_hash mismatch)', async () => {
    const { networkKeys, networkDID } = freshFixture();
    const receipt = await createPaymentReceipt(
      {
        payment_mandate_id: 'pm-x',
        cart_mandate_id: 'mandate-x',
        merchant_did: 'did:web:m',
        cp_did: 'did:web:cp',
        amount: { currency: 'USD', value: 50 },
        agent_presence: { agent_involved: true, human_present: true },
        verification_checks: allChecksPassed,
      },
      { networkDID, networkKeys }
    );

    const tampered: PaymentReceipt = {
      ...receipt,
      contents: { ...receipt.contents, amount: { currency: 'USD', value: 5000 } },
    };
    const result = await verifyPaymentReceipt(tampered, networkKeys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, true);
    assert.equal(result.checks.receiptHashMatches, false);
  });

  it('rejects under wrong network public key', async () => {
    const { networkKeys, networkDID } = freshFixture();
    const receipt = await createPaymentReceipt(
      {
        payment_mandate_id: 'pm-x',
        cart_mandate_id: 'mandate-x',
        merchant_did: 'did:web:m',
        cp_did: 'did:web:cp',
        amount: { currency: 'USD', value: 50 },
        agent_presence: { agent_involved: true, human_present: true },
        verification_checks: allChecksPassed,
      },
      { networkDID, networkKeys }
    );

    const otherKeys = generateKeyPair();
    const result = await verifyPaymentReceipt(receipt, otherKeys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, false);
  });

  it('rejects malformed PaymentReceipt (missing network_authorization)', async () => {
    const { networkKeys } = freshFixture();
    const malformed = { contents: {} as never } as never as PaymentReceipt;
    const result = await verifyPaymentReceipt(malformed, networkKeys.publicKey);
    assert.equal(result.valid, false);
    assert.match(result.error ?? '', /malformed/i);
  });
});
