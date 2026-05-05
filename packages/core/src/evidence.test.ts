import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from './did';
import { createCartMandate, type CartData } from './mandates';
import { extractEvidenceBundle } from './evidence';

const DOMAIN = 'ap2--vtexeurope.myvtex.com';

function makeCart(overrides?: Partial<CartData>): CartData {
  return {
    items: [{ sku: '5', name: 'Tricou', quantity: 1, unitPrice: 55.24 }],
    totalAmount: 55.24,
    currency: 'RON',
    orderFormId: 'ev-of-1',
    ...overrides,
  };
}

describe('evidence - extractEvidenceBundle', () => {
  it('extracts mandateId, cartHash, signedAt, signedBy from a valid mandate', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);

    const bundle = extractEvidenceBundle(mandate);

    assert.equal(bundle.mandateId, mandate.contents.id);
    assert.strictEqual(bundle.cartMandate, mandate);
    assert.equal(typeof bundle.cartHash, 'string');
    assert.equal(bundle.cartHash.length, 64); // SHA-256 hex
    assert.equal(bundle.signedBy, `did:web:${DOMAIN}`);

    // signedAt should parse as a valid ISO timestamp close to "now"
    const t = new Date(bundle.signedAt).getTime();
    assert.ok(!isNaN(t), 'signedAt should be a valid ISO timestamp');
    const now = Date.now();
    assert.ok(now - t < 5000, 'signedAt should be recent');
  });

  it('cartHash matches the JWT cart_hash claim', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);
    const bundle = extractEvidenceBundle(mandate);
    const payload = JSON.parse(
      Buffer.from(mandate.merchant_authorization.split('.')[1], 'base64url').toString()
    );
    assert.equal(bundle.cartHash, payload.cart_hash);
  });

  it('signedBy preserves the merchant DID even if domain config changes later', async () => {
    const keys = generateKeyPair();
    const mandate = await createCartMandate(makeCart(), DOMAIN, keys);
    const bundle = extractEvidenceBundle(mandate);
    // signedBy is sourced from contents.merchant_name (which is the DID
    // at sign time) — not from any "current" config the verifier holds.
    assert.equal(bundle.signedBy, mandate.contents.merchant_name);
  });

  it('throws on malformed JWT (wrong shape)', () => {
    const fake = {
      contents: {
        id: 'mandate-x',
        merchant_name: 'did:web:x',
        payment_items: [],
        total: { currency: 'RON', value: '0.00' },
        cart_expiry: new Date().toISOString(),
      },
      merchant_authorization: 'not.a.jwt.with.too.many.parts',
    } as unknown as Parameters<typeof extractEvidenceBundle>[0];
    assert.throws(() => extractEvidenceBundle(fake), /malformed JWT/i);
  });

  it('throws when merchant_authorization is missing', () => {
    const fake = {
      contents: {
        id: 'mandate-x',
        merchant_name: 'did:web:x',
        payment_items: [],
        total: { currency: 'RON', value: '0.00' },
        cart_expiry: new Date().toISOString(),
      },
    } as unknown as Parameters<typeof extractEvidenceBundle>[0];
    assert.throws(() => extractEvidenceBundle(fake), /malformed mandate/i);
  });

  it('throws when JWT payload base64 cannot be decoded', () => {
    const fake = {
      contents: {
        id: 'mandate-x',
        merchant_name: 'did:web:x',
        payment_items: [],
        total: { currency: 'RON', value: '0.00' },
        cart_expiry: new Date().toISOString(),
      },
      merchant_authorization: 'aaa.@@@.ccc',
    } as unknown as Parameters<typeof extractEvidenceBundle>[0];
    assert.throws(() => extractEvidenceBundle(fake), /decode|missing/i);
  });
});
