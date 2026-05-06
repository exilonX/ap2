/**
 * create_cart_mandate tests.
 *
 * Covers:
 *   - happy path: signs and returns a mandate envelope with valid fields
 *   - empty cart returns a graceful error message
 *   - missing orderFormId returns a graceful error message
 *   - resulting mandate verifies via `MandateOrchestration.retrieve` round-trip
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCartMandateTool } from '../create-cart-mandate';
import { MandateOrchestration } from '../../mandates/mandate-orchestration';
import { MerchantIdentity } from '../../identity/merchant-identity';
import { VBaseKeyStore } from '../../identity/vbase-keystore';
import { makeFakeToolContext, seedCart } from './fakes';

describe('create_cart_mandate', () => {
  it('signs a mandate for the current cart and returns the envelope', async () => {
    const deps = makeFakeToolContext();
    seedCart(deps, [{ sku: 'apple', quantity: 1, unitPriceCents: 5000 }]);

    const effect = await createCartMandateTool.execute({}, deps.ctx);

    assert.ok(effect.mandate, 'mandate envelope present');
    assert.match(effect.mandate!.mandateId, /^mandate-/);
    assert.match(effect.mandate!.retrievalUrl, /\/_v\/acg\/mandates\/mandate-/);
    assert.match(effect.mandate!.didDocumentUrl, /\/.well-known\/did\.json$/);
    assert.equal(effect.mandate!.signedBy, 'did:web:fakeacct.myvtex.com');
    assert.match(effect.result, /Signed mandate mandate-/);
    assert.match(effect.result, /1 items/);
  });

  it('returns graceful error when the cart has no items', async () => {
    const deps = makeFakeToolContext();
    // seed with an empty cart
    seedCart(deps, []);

    const effect = await createCartMandateTool.execute({}, deps.ctx);

    assert.equal(effect.mandate, undefined);
    assert.match(effect.result, /empty/i);
  });

  it('returns graceful error when there is no orderFormId at all', async () => {
    const deps = makeFakeToolContext({ orderFormId: null });

    const effect = await createCartMandateTool.execute({}, deps.ctx);

    assert.equal(effect.mandate, undefined);
    assert.match(effect.result, /empty/i);
  });

  it('persisted mandate is retrievable and verifies', async () => {
    const deps = makeFakeToolContext();
    seedCart(deps, [{ sku: 'banana', quantity: 2, unitPriceCents: 3000 }]);

    const effect = await createCartMandateTool.execute({}, deps.ctx);
    assert.ok(effect.mandate);

    // Independent retrieval through the orchestration module verifies persistence.
    const identity = new MerchantIdentity({
      keyStore: new VBaseKeyStore(deps.vbase),
      domain: 'fakeacct.myvtex.com',
    });
    const orchestration = new MandateOrchestration({
      identity,
      vbase: deps.vbase,
    });
    const retrieved = await orchestration.retrieve(effect.mandate!.mandateId);
    assert.ok(retrieved, 'mandate persisted in vbase');
    assert.equal(retrieved!.cartHash, effect.mandate!.cartHash);

    const verification = await orchestration.verify(effect.mandate!.mandateId);
    assert.equal(verification.valid, true);
    assert.equal(verification.checks.signatureValid, true);
    assert.equal(verification.checks.hashMatches, true);
  });
});
