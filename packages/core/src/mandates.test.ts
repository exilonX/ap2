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

describe('mandates - createCartMandate (AP2 spec)', () => {
  it('creates a mandate with nested structure per AP2 spec', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    // AP2 structure: { contents, merchant_authorization }
    assert.ok(mandate.contents);
    assert.ok(mandate.merchant_authorization);
    assert.ok(typeof mandate.merchant_authorization === 'string');
    // JWT has 3 base64url-encoded parts separated by dots
    assert.equal(mandate.merchant_authorization.split('.').length, 3);
  });

  it('contents have W3C PaymentItem format', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    assert.ok(mandate.contents.id.startsWith('mandate-'));
    assert.equal(mandate.contents.merchant_name, 'did:web:ap2--vtexeurope.myvtex.com');
    assert.equal(mandate.contents.payment_items.length, 2);

    // W3C PaymentItem format: { label, amount: { currency, value } }
    const item = mandate.contents.payment_items[0];
    assert.equal(item.label, 'Tricou');
    assert.equal(item.amount.currency, 'RON');
    assert.equal(item.amount.value, '110.48'); // 55.24 * 2
    assert.equal(item.sku, '5');
    assert.equal(item.quantity, 2);
  });

  it('total uses W3C PaymentCurrencyAmount format', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    assert.equal(mandate.contents.total.currency, 'RON');
    assert.equal(mandate.contents.total.value, '110.56');
  });

  it('includes order_reference from orderFormId', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);
    assert.equal(mandate.contents.order_reference, 'test-order-form-123');
  });

  it('sets correct cart_expiry (default 10 minutes)', async () => {
    const keys = generateKeyPair();
    const before = Date.now();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    const expiry = new Date(mandate.contents.cart_expiry).getTime();
    const diff = expiry - before;
    // Should be ~10 minutes (600000ms) ± 2 second tolerance
    assert.ok(diff >= 598000 && diff <= 602000, `Expected ~600000ms, got ${diff}ms`);
  });

  it('respects custom expiry', async () => {
    const keys = generateKeyPair();
    const before = Date.now();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys, 30);

    const expiry = new Date(mandate.contents.cart_expiry).getTime();
    const diff = expiry - before;
    assert.ok(diff >= 1798000 && diff <= 1802000, `Expected ~1800000ms, got ${diff}ms`);
  });

  it('generates unique mandate IDs', async () => {
    const keys = generateKeyPair();
    const a = await createCartMandate(makeCart(), DOMAIN, keys);
    const b = await createCartMandate(makeCart(), DOMAIN, keys);
    assert.notEqual(a.contents.id, b.contents.id);
  });

  it('JWT header uses EdDSA algorithm', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    const headerBase64 = mandate.merchant_authorization.split('.')[0];
    const header = JSON.parse(Buffer.from(headerBase64, 'base64url').toString());
    assert.equal(header.alg, 'EdDSA');
    assert.equal(header.typ, 'JWT');
  });

  it('JWT payload contains cart_hash and standard claims', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    const payloadBase64 = mandate.merchant_authorization.split('.')[1];
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString());

    assert.equal(payload.iss, 'did:web:ap2--vtexeurope.myvtex.com');
    assert.ok(payload.sub.startsWith('mandate-'));
    assert.equal(payload.aud, 'ap2');
    assert.ok(typeof payload.iat === 'number');
    assert.ok(typeof payload.exp === 'number');
    assert.ok(typeof payload.jti === 'string');
    assert.ok(typeof payload.cart_hash === 'string');
    assert.equal(payload.cart_hash.length, 64); // SHA-256 hex
  });
});

describe('mandates - verifyCartMandate (AP2 spec)', () => {
  it('verifies a valid mandate', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);
    const result = await verifyCartMandate(mandate, keys.publicKey);

    assert.equal(result.valid, true);
    assert.equal(result.checks.signatureValid, true);
    assert.equal(result.checks.notExpired, true);
    assert.equal(result.checks.hashMatches, true);
    assert.equal(result.error, undefined);
    assert.ok(result.payload);
    assert.ok(result.payload.cart_hash);
  });

  it('fails with wrong public key', async () => {
    const keys1 = generateKeyPair();
    const keys2 = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys1);
    const result = await verifyCartMandate(mandate, keys2.publicKey);

    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, false);
    assert.equal(result.error, 'Invalid JWT signature');
  });

  it('fails when cart contents are tampered (total changed)', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    // Tamper with total
    mandate.contents.total.value = '999.99';

    const result = await verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.hashMatches, false);
    assert.ok(result.error?.includes('tampered'));
  });

  it('fails when cart item is tampered', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    // Tamper with an item price
    mandate.contents.payment_items[0].amount.value = '999.99';

    const result = await verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.hashMatches, false);
  });

  it('fails when mandate is expired', async () => {
    const keys = generateKeyPair();
    // Create a mandate that expires in 2 seconds (2/60 minutes)
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys, 2 / 60);

    // Wait for it to expire
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const result = await verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.notExpired, false);
    assert.ok(result.error?.includes('expired'));
  });

  it('fails with corrupted JWT', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    mandate.merchant_authorization = 'invalid.jwt.here';

    const result = await verifyCartMandate(mandate, keys.publicKey);
    assert.equal(result.valid, false);
    assert.equal(result.checks.signatureValid, false);
  });

  it('works with restored keys from hex', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    const { keyPairFromHex } = await import('./did');
    const restored = keyPairFromHex(keys.publicKeyHex, keys.privateKeyHex);
    const result = await verifyCartMandate(mandate, restored.publicKey);
    assert.equal(result.valid, true);
  });
});

describe('mandates - mandateMatchesCart', () => {
  it('returns true when cart matches', async () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = await createCartMandate(cart, DOMAIN, keys);
    assert.equal(mandateMatchesCart(mandate, cart), true);
  });

  it('returns false when total changed', async () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = await createCartMandate(cart, DOMAIN, keys);
    assert.equal(mandateMatchesCart(mandate, makeCart({ totalAmount: 999.99 })), false);
  });

  it('returns false when currency changed', async () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = await createCartMandate(cart, DOMAIN, keys);
    assert.equal(mandateMatchesCart(mandate, makeCart({ currency: 'USD' })), false);
  });

  it('returns false when orderFormId changed', async () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = await createCartMandate(cart, DOMAIN, keys);
    assert.equal(mandateMatchesCart(mandate, makeCart({ orderFormId: 'different' })), false);
  });

  it('returns false when item count changed', async () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = await createCartMandate(cart, DOMAIN, keys);
    const modified = makeCart({ items: [{ sku: '5', name: 'Tricou', quantity: 2, unitPrice: 55.24 }] });
    assert.equal(mandateMatchesCart(mandate, modified), false);
  });

  it('returns false when item quantity changed', async () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = await createCartMandate(cart, DOMAIN, keys);
    const modified = makeCart({
      items: [
        { sku: '5', name: 'Tricou', quantity: 5, unitPrice: 55.24 },
        { sku: '1', name: 'Rochita Roz', quantity: 1, unitPrice: 0.08 },
      ],
    });
    assert.equal(mandateMatchesCart(mandate, modified), false);
  });

  it('returns false when item price changed', async () => {
    const keys = generateKeyPair();
    const cart = makeCart();
    const mandate = await createCartMandate(cart, DOMAIN, keys);
    const modified = makeCart({
      items: [
        { sku: '5', name: 'Tricou', quantity: 2, unitPrice: 60.00 },
        { sku: '1', name: 'Rochita Roz', quantity: 1, unitPrice: 0.08 },
      ],
    });
    assert.equal(mandateMatchesCart(mandate, modified), false);
  });
});
