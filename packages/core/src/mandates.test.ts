import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from './did';
import { createCartMandate, verifyCartMandate, mandateMatchesCart, type CartData } from './mandates';

function makeCart(overrides?: Partial<CartData>): CartData {
  return {
    items: [
      { sku: '5', name: 'Tricou', quantity: 2, unitPrice: 55.24 },
      { sku: '1', name: 'Rochita Roz', quantity: 1, unitPrice: 0.08 },
    ],
    totalAmount: 110.56,
    currency: 'RON',
    orderFormId: 'test-order-form-123',
    ...overrides,
  };
}

const DOMAIN = 'ap2--vtexeurope.myvtex.com';

describe('mandates - createCartMandate', () => {
  it('creates a mandate with all required fields', () => {
    const keys = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys);

    assert.ok(mandate.mandateId.startsWith('mandate-'));
    assert.equal(mandate.version, '0.1.0');
    assert.equal(mandate.type, 'CartMandate');
    assert.equal(mandate.lineItems.length, 2);
    assert.equal(mandate.totalAmount, 110.56);
    assert.equal(mandate.currency, 'RON');
    assert.equal(mandate.orderFormId, 'test-order-form-123');
    assert.equal(mandate.merchantDid, 'did:web:ap2--vtexeurope.myvtex.com');
    assert.ok(mandate.canonicalHash.length === 64);
    assert.ok(mandate.signature.length > 0);
    assert.ok(mandate.signedAt);
    assert.ok(mandate.expiresAt);
    assert.ok(mandate.nonce.length > 0);
  });

  it('sets correct expiry (default 10 minutes)', () => {
    const keys = generateKeyPair();
    const before = Date.now();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys);
    const after = Date.now();

    const expiresAt = new Date(mandate.expiresAt).getTime();
    const signedAt = new Date(mandate.signedAt).getTime();
    const diff = expiresAt - signedAt;

    // Should be 10 minutes (600000ms) ± 1 second tolerance
    assert.ok(diff >= 599000 && diff <= 601000, `Expected ~600000ms, got ${diff}ms`);
  });

  it('respects custom expiry', () => {
    const keys = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys, 30);

    const expiresAt = new Date(mandate.expiresAt).getTime();
    const signedAt = new Date(mandate.signedAt).getTime();
    const diff = expiresAt - signedAt;

    // Should be 30 minutes
    assert.ok(diff >= 1799000 && diff <= 1801000, `Expected ~1800000ms, got ${diff}ms`);
  });

  it('generates unique mandate IDs', () => {
    const keys = generateKeyPair();
    const a = createCartMandate(makeCart(), DOMAIN, keys);
    const b = createCartMandate(makeCart(), DOMAIN, keys);
    assert.notEqual(a.mandateId, b.mandateId);
  });

  it('generates unique nonces', () => {
    const keys = generateKeyPair();
    const a = createCartMandate(makeCart(), DOMAIN, keys);
    const b = createCartMandate(makeCart(), DOMAIN, keys);
    assert.notEqual(a.nonce, b.nonce);
  });

  it('line items match input cart', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    assert.equal(mandate.lineItems[0].sku, '5');
    assert.equal(mandate.lineItems[0].name, 'Tricou');
    assert.equal(mandate.lineItems[0].quantity, 2);
    assert.equal(mandate.lineItems[0].unitPrice, 55.24);
    assert.equal(mandate.lineItems[1].sku, '1');
  });
});

describe('mandates - verifyCartMandate', () => {
  it('verifies a valid mandate', () => {
    const keys = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys);
    const result = verifyCartMandate(mandate, keys.publicKey);

    assert.equal(result.valid, true);
    assert.equal(result.checks.signatureValid, true);
    assert.equal(result.checks.notExpired, true);
    assert.equal(result.checks.hashMatches, true);
    assert.equal(result.error, undefined);
  });

  it('fails with wrong public key', () => {
    const keys1 = generateKeyPair();
    const keys2 = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys1);
    const result = verifyCartMandate(mandate, keys2.publicKey);

    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, false);
    assert.equal(result.error, 'Invalid signature');
  });

  it('fails when mandate is tampered (price changed)', () => {
    const keys = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys);

    // Tamper with the total
    mandate.totalAmount = 999.99;

    const result = verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.hashMatches, false);
    assert.equal(result.error, 'Cart contents have been tampered with');
  });

  it('fails when mandate is tampered (item changed)', () => {
    const keys = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys);

    // Tamper with an item price
    mandate.lineItems[0].unitPrice = 99.99;

    const result = verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.hashMatches, false);
  });

  it('fails when mandate is tampered (nonce changed)', () => {
    const keys = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys);

    mandate.nonce = 'tampered-nonce';

    const result = verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.hashMatches, false);
  });

  it('fails when mandate is expired', () => {
    const keys = generateKeyPair();
    // Create mandate that expired 1 minute ago
    const mandate = createCartMandate(makeCart(), DOMAIN, keys, -1);

    const result = verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.notExpired, false);
    assert.equal(result.error, 'Mandate has expired');
  });

  it('fails with corrupted signature', () => {
    const keys = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys);

    mandate.signature = 'deadbeef'.repeat(16);

    const result = verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, false);
  });

  it('signature check catches completely invalid signature format', () => {
    const keys = generateKeyPair();
    const mandate = createCartMandate(makeCart(), DOMAIN, keys);

    mandate.signature = 'not-a-valid-hex';

    const result = verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, false);
  });
});

describe('mandates - mandateMatchesCart', () => {
  it('returns true when cart matches', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    assert.equal(mandateMatchesCart(mandate, cart), true);
  });

  it('returns false when total changed', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    const modifiedCart = makeCart({ totalAmount: 999.99 });
    assert.equal(mandateMatchesCart(mandate, modifiedCart), false);
  });

  it('returns false when currency changed', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    const modifiedCart = makeCart({ currency: 'USD' });
    assert.equal(mandateMatchesCart(mandate, modifiedCart), false);
  });

  it('returns false when orderFormId changed', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    const modifiedCart = makeCart({ orderFormId: 'different-id' });
    assert.equal(mandateMatchesCart(mandate, modifiedCart), false);
  });

  it('returns false when item count changed', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    const modifiedCart = makeCart({
      items: [{ sku: '5', name: 'Tricou', quantity: 2, unitPrice: 55.24 }],
    });
    assert.equal(mandateMatchesCart(mandate, modifiedCart), false);
  });

  it('returns false when item SKU changed', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    const modifiedCart = makeCart({
      items: [
        { sku: '999', name: 'Tricou', quantity: 2, unitPrice: 55.24 },
        { sku: '1', name: 'Rochita Roz', quantity: 1, unitPrice: 0.08 },
      ],
    });
    assert.equal(mandateMatchesCart(mandate, modifiedCart), false);
  });

  it('returns false when item quantity changed', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    const modifiedCart = makeCart({
      items: [
        { sku: '5', name: 'Tricou', quantity: 5, unitPrice: 55.24 },
        { sku: '1', name: 'Rochita Roz', quantity: 1, unitPrice: 0.08 },
      ],
    });
    assert.equal(mandateMatchesCart(mandate, modifiedCart), false);
  });

  it('returns false when item price changed', () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = createCartMandate(cart, DOMAIN, keys);

    const modifiedCart = makeCart({
      items: [
        { sku: '5', name: 'Tricou', quantity: 2, unitPrice: 60.00 },
        { sku: '1', name: 'Rochita Roz', quantity: 1, unitPrice: 0.08 },
      ],
    });
    assert.equal(mandateMatchesCart(mandate, modifiedCart), false);
  });
});
