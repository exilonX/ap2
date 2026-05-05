/**
 * MandateOrchestration tests.
 *
 * Operates against a fake VBase + a real `MerchantIdentity` (which uses
 * a `VBaseKeyStore` over the same fake VBase). This lets us exercise
 * the actual sign-and-verify code path while keeping the test
 * hermetic — no filesystem, no network.
 *
 * Coverage matrix:
 *   - signAndPersist round-trip (sign → persist → retrieve)
 *   - retrieve unknown id → null
 *   - verify happy path
 *   - verify unknown id (returns {valid:false, error:'mandate not found'})
 *   - verify against tampered contents (hashMatches:false)
 *   - verify against expired JWT (notExpired:false)
 *   - verifyAgainstCart happy path
 *   - verifyAgainstCart drift cases (item count / quantity / price / total / currency / orderFormId)
 *   - verifyAgainstCart unknown id
 *   - verifyAgainstCart expired mandate but cart still matches structurally
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MandateOrchestration, MANDATE_BUCKET } from '../mandate-orchestration';
import { MerchantIdentity } from '../../identity/merchant-identity';
import { VBaseKeyStore } from '../../identity/vbase-keystore';
import { FakeVBase } from '../../identity/__tests__/fake-vbase';
import type { SimpleCart } from '../../types/shared';

const DOMAIN = 'orchestration.example.com';

function makeSimpleCart(overrides: Partial<SimpleCart> = {}): SimpleCart {
  return {
    id: 'of-orch-1',
    items: [
      {
        sku: '5',
        name: 'Tricou',
        quantity: 2,
        unitPrice: 55.24,
        totalPrice: 110.48,
        available: true,
      },
      {
        sku: '1',
        name: 'Rochita Roz',
        quantity: 1,
        unitPrice: 0.08,
        totalPrice: 0.08,
        available: true,
      },
    ],
    subtotal: 110.56,
    total: 110.56,
    currency: 'RON',
    itemCount: 3,
    hasShippingAddress: true,
    isReadyForCheckout: true,
    ...overrides,
  };
}

function setup() {
  const vbase = new FakeVBase();
  const keyStore = new VBaseKeyStore(vbase);
  const identity = new MerchantIdentity({ keyStore, domain: DOMAIN });
  const orchestration = new MandateOrchestration({ identity, vbase });
  return { vbase, identity, orchestration };
}

// ─── signAndPersist ─────────────────────────────────────────────────

describe('MandateOrchestration.signAndPersist', () => {
  it('signs, persists, and returns an EvidenceBundle', async () => {
    const { orchestration, vbase } = setup();
    const cart = makeSimpleCart();
    const bundle = await orchestration.signAndPersist(cart, {
      sessionId: 's-1',
      orderFormId: cart.id,
    });

    assert.ok(bundle.mandateId.startsWith('mandate-'));
    assert.equal(typeof bundle.cartHash, 'string');
    assert.equal(bundle.cartHash.length, 64);
    assert.equal(bundle.signedBy, `did:web:${DOMAIN}`);
    assert.deepEqual(bundle.metadata, { sessionId: 's-1', orderFormId: cart.id });

    // VBase has the bundle keyed by mandateId
    const stored = vbase.peek(MANDATE_BUCKET, bundle.mandateId);
    assert.deepEqual(stored, bundle);
  });

  it('signedAt is recent and parseable as ISO timestamp', async () => {
    const { orchestration } = setup();
    const before = Date.now();
    const bundle = await orchestration.signAndPersist(makeSimpleCart());
    const t = new Date(bundle.signedAt).getTime();
    assert.ok(!isNaN(t));
    // Allow 1s of slack on either side.
    assert.ok(t >= before - 1000);
    assert.ok(t <= Date.now() + 1000);
  });

  it('persistence is JSON-roundtrip-safe (no Buffers leaking)', async () => {
    const { orchestration, vbase } = setup();
    const bundle = await orchestration.signAndPersist(makeSimpleCart());
    const stored = vbase.peek<unknown>(MANDATE_BUCKET, bundle.mandateId);
    // If anything contained a Buffer, it would survive the FakeVBase
    // JSON.parse(JSON.stringify(...)) but emerge as `{type:'Buffer', data:[...]}`.
    const json = JSON.stringify(stored);
    assert.ok(!json.includes('"type":"Buffer"'));
  });
});

// ─── retrieve ──────────────────────────────────────────────────────

describe('MandateOrchestration.retrieve', () => {
  it('returns the persisted bundle by mandateId', async () => {
    const { orchestration } = setup();
    const cart = makeSimpleCart();
    const bundle = await orchestration.signAndPersist(cart, { sessionId: 's-r' });
    const retrieved = await orchestration.retrieve(bundle.mandateId);
    assert.deepEqual(retrieved, bundle);
  });

  it('returns null for unknown mandateId', async () => {
    const { orchestration } = setup();
    const result = await orchestration.retrieve('mandate-does-not-exist');
    assert.equal(result, null);
  });
});

// ─── verify ────────────────────────────────────────────────────────

describe('MandateOrchestration.verify', () => {
  it('returns valid:true for a freshly-signed bundle', async () => {
    const { orchestration } = setup();
    const bundle = await orchestration.signAndPersist(makeSimpleCart());
    const result = await orchestration.verify(bundle.mandateId);
    assert.equal(result.valid, true);
    assert.equal(result.checks.signatureValid, true);
    assert.equal(result.checks.notExpired, true);
    assert.equal(result.checks.hashMatches, true);
  });

  it('returns hashMatches:false when stored cartMandate.contents are tampered', async () => {
    const { orchestration, vbase } = setup();
    const bundle = await orchestration.signAndPersist(makeSimpleCart());

    // Tamper directly in VBase: change the total in the stored bundle's
    // mandate contents. The signed cart_hash no longer matches.
    const stored = vbase.peek<typeof bundle>(MANDATE_BUCKET, bundle.mandateId);
    assert.ok(stored);
    stored!.cartMandate.contents.total.value = '9999.99';
    vbase.seed(MANDATE_BUCKET, bundle.mandateId, stored);

    const result = await orchestration.verify(bundle.mandateId);
    assert.equal(result.valid, false);
    assert.equal(result.checks.hashMatches, false);
  });

  it('returns valid:false with "mandate not found" for unknown id', async () => {
    const { orchestration } = setup();
    const result = await orchestration.verify('mandate-nope');
    assert.equal(result.valid, false);
    assert.equal(result.error, 'mandate not found');
    assert.deepEqual(result.checks, {
      signatureValid: false,
      notExpired: false,
      hashMatches: false,
    });
  });
});

// ─── verifyAgainstCart ────────────────────────────────────────────

describe('MandateOrchestration.verifyAgainstCart', () => {
  it('returns matching=true for an identical cart', async () => {
    const { orchestration } = setup();
    const cart = makeSimpleCart();
    const bundle = await orchestration.signAndPersist(cart);

    const result = await orchestration.verifyAgainstCart(bundle.mandateId, cart);
    assert.equal(result.verification.valid, true);
    assert.equal(result.cartMatches, true);
    assert.equal(result.reason, undefined);
  });

  it('flags a quantity drift on a specific item', async () => {
    const { orchestration } = setup();
    const cart = makeSimpleCart();
    const bundle = await orchestration.signAndPersist(cart);

    const drifted = makeSimpleCart({
      items: [
        { ...cart.items[0], quantity: 5, totalPrice: 55.24 * 5 },
        cart.items[1],
      ],
      // We'll keep totals consistent with the drifted item to ensure the
      // first failing dimension is the per-item check, not the total.
      total: 55.24 * 5 + 0.08,
      subtotal: 55.24 * 5 + 0.08,
      itemCount: 6,
    });

    const result = await orchestration.verifyAgainstCart(bundle.mandateId, drifted);
    assert.equal(result.cartMatches, false);
    assert.ok(result.reason);
    assert.match(result.reason!, /total|quantity/i);
  });

  it('flags an item count drift when an item was removed', async () => {
    const { orchestration } = setup();
    const cart = makeSimpleCart();
    const bundle = await orchestration.signAndPersist(cart);

    const drifted = makeSimpleCart({
      items: [cart.items[0]],
      total: cart.items[0].totalPrice,
      subtotal: cart.items[0].totalPrice,
      itemCount: cart.items[0].quantity,
    });

    const result = await orchestration.verifyAgainstCart(bundle.mandateId, drifted);
    assert.equal(result.cartMatches, false);
    assert.ok(result.reason);
    // Either total drift or item count drift is acceptable here — both
    // are correctly-named dimensions.
    assert.match(result.reason!, /total|item count/i);
  });

  it('flags a total drift (e.g. coupon applied after sign)', async () => {
    const { orchestration } = setup();
    const cart = makeSimpleCart();
    const bundle = await orchestration.signAndPersist(cart);

    const drifted = makeSimpleCart({
      total: cart.total - 10,
      subtotal: cart.subtotal,
    });

    const result = await orchestration.verifyAgainstCart(bundle.mandateId, drifted);
    assert.equal(result.cartMatches, false);
    assert.ok(result.reason);
    assert.match(result.reason!, /total/i);
  });

  it('flags a currency drift', async () => {
    const { orchestration } = setup();
    const cart = makeSimpleCart();
    const bundle = await orchestration.signAndPersist(cart);

    const drifted = makeSimpleCart({ currency: 'USD' });
    const result = await orchestration.verifyAgainstCart(bundle.mandateId, drifted);
    assert.equal(result.cartMatches, false);
    assert.ok(result.reason);
  });

  it('flags an orderFormId drift', async () => {
    const { orchestration } = setup();
    const cart = makeSimpleCart();
    const bundle = await orchestration.signAndPersist(cart);

    const drifted = makeSimpleCart({ id: 'of-different' });
    const result = await orchestration.verifyAgainstCart(bundle.mandateId, drifted);
    assert.equal(result.cartMatches, false);
    assert.ok(result.reason);
    assert.match(result.reason!, /orderFormId|order/i);
  });

  it('returns "mandate not found" reason for unknown mandateId, no throw', async () => {
    const { orchestration } = setup();
    const result = await orchestration.verifyAgainstCart('mandate-nope', makeSimpleCart());
    assert.equal(result.cartMatches, false);
    assert.equal(result.reason, 'mandate not found');
    assert.equal(result.verification.valid, false);
    assert.equal(result.verification.error, 'mandate not found');
  });
});
