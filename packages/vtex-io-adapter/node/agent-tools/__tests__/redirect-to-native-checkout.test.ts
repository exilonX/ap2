/**
 * redirect_to_native_checkout tests.
 *
 * Covers:
 *   - happy path: signs + returns a VTEX checkout URL with the right orderFormId
 *   - empty cart returns a graceful error message
 *   - workspace formatting: master vs. non-master domain composition
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { redirectToNativeCheckoutTool } from '../redirect-to-native-checkout';
import { makeFakeToolContext, seedCart } from './fakes';

describe('redirect_to_native_checkout', () => {
  it('signs and returns a VTEX native checkout URL', async () => {
    const deps = makeFakeToolContext({ workspace: 'master', account: 'fakeacct' });
    seedCart(deps, [{ sku: 'apple', quantity: 1, unitPriceCents: 5000 }]);

    const effect = await redirectToNativeCheckoutTool.execute({}, deps.ctx);

    assert.ok(effect.mandate, 'mandate envelope present (signed for audit per Path A)');
    assert.match(
      effect.result,
      /Continue to VTEX native checkout: https:\/\/fakeacct\.myvtex\.com\/checkout\/\?orderFormId=of-test-1/
    );
  });

  it('uses the workspace-prefixed host for non-master workspaces', async () => {
    const deps = makeFakeToolContext({ workspace: 'acg', account: 'fakeacct' });
    seedCart(deps, [{ sku: 'apple', quantity: 1, unitPriceCents: 5000 }]);

    const effect = await redirectToNativeCheckoutTool.execute({}, deps.ctx);

    assert.ok(effect.mandate);
    assert.match(
      effect.result,
      /https:\/\/acg--fakeacct\.myvtex\.com\/checkout\//
    );
    assert.equal(effect.mandate!.signedBy, 'did:web:acg--fakeacct.myvtex.com');
  });

  it('returns graceful error when cart is empty', async () => {
    const deps = makeFakeToolContext();
    seedCart(deps, []);

    const effect = await redirectToNativeCheckoutTool.execute({}, deps.ctx);

    assert.equal(effect.mandate, undefined);
    assert.match(effect.result, /empty/i);
  });

  it('returns graceful error when there is no orderFormId', async () => {
    const deps = makeFakeToolContext({ orderFormId: null });

    const effect = await redirectToNativeCheckoutTool.execute({}, deps.ctx);

    assert.equal(effect.mandate, undefined);
    assert.match(effect.result, /empty/i);
  });
});
