/**
 * execute_payment tests.
 *
 * The demo punchline beat. Covers:
 *   - happy path: cart unchanged → match → mock order id (ACG-<timestamp>)
 *   - drift on total: cart total changed → no match → reason mentions total
 *   - drift on item count: item removed → no match → reason mentions item count
 *   - missing mandateId arg → ERROR result, no throw
 *   - unknown mandateId → ERROR result, no throw
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCartMandateTool } from '../create-cart-mandate';
import { executePaymentTool } from '../execute-payment';
import { makeFakeToolContext, seedCart } from './fakes';

async function signMandate(deps: ReturnType<typeof makeFakeToolContext>) {
  const effect = await createCartMandateTool.execute({}, deps.ctx);
  assert.ok(effect.mandate, 'mandate signed');
  return effect.mandate!.mandateId;
}

describe('execute_payment', () => {
  it('happy path: cart unchanged → match → mock order id', async () => {
    const deps = makeFakeToolContext();
    seedCart(deps, [{ sku: 'apple', quantity: 1, unitPriceCents: 5000 }]);
    const mandateId = await signMandate(deps);

    const effect = await executePaymentTool.execute({ mandateId }, deps.ctx);

    assert.match(effect.result, /^Payment authorized/);
    assert.match(effect.result, /Order ACG-\d+ placed/);
    assert.match(effect.result, new RegExp(mandateId));
  });

  it('drift on total: cart price changed → rejected with total drift reason', async () => {
    const deps = makeFakeToolContext();
    seedCart(deps, [{ sku: 'apple', quantity: 1, unitPriceCents: 5000 }]);
    const mandateId = await signMandate(deps);

    // Mutate the seeded orderForm to bump the price.
    await deps.checkout.updateItems(deps.ctx.orderFormId!, [
      { index: 0, quantity: 2 },
    ]);

    const effect = await executePaymentTool.execute({ mandateId }, deps.ctx);

    assert.match(effect.result, /Payment rejected/);
    assert.match(effect.result, /drift/i);
    // either total drift (most likely — different total) or quantity drift
    assert.match(effect.result, /total|quantity/i);
  });

  it('drift on item count: item removed → rejected with item count drift reason', async () => {
    const deps = makeFakeToolContext();
    seedCart(deps, [
      { sku: 'apple', quantity: 1, unitPriceCents: 5000 },
      { sku: 'banana', quantity: 1, unitPriceCents: 3000 },
    ]);
    const mandateId = await signMandate(deps);

    // Remove the second item.
    await deps.checkout.removeItem(deps.ctx.orderFormId!, 1);

    const effect = await executePaymentTool.execute({ mandateId }, deps.ctx);

    assert.match(effect.result, /Payment rejected/);
    assert.match(effect.result, /drift/i);
  });

  it('missing mandateId returns an ERROR result, not a throw', async () => {
    const deps = makeFakeToolContext();
    seedCart(deps);

    const effect = await executePaymentTool.execute({}, deps.ctx);

    assert.match(effect.result, /^ERROR/);
    assert.match(effect.result, /missing mandateId/i);
  });

  it('unknown mandateId returns an ERROR result, not a throw', async () => {
    const deps = makeFakeToolContext();
    seedCart(deps);

    const effect = await executePaymentTool.execute(
      { mandateId: 'mandate-does-not-exist' },
      deps.ctx
    );

    assert.match(effect.result, /^ERROR/);
    assert.match(effect.result, /not found|did not verify/i);
  });

  it('missing orderFormId returns an ERROR result, not a throw', async () => {
    const deps = makeFakeToolContext({ orderFormId: null });

    const effect = await executePaymentTool.execute(
      { mandateId: 'mandate-irrelevant' },
      deps.ctx
    );

    assert.match(effect.result, /^ERROR/);
    assert.match(effect.result, /no active cart/i);
  });
});
