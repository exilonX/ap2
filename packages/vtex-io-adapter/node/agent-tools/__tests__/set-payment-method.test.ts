/**
 * set_payment_method tests.
 *
 * Covers:
 *   - happy path: records the chosen system, surfaces the updated total
 *   - missing paymentSystemId
 *   - cart with no items / no session
 *   - rejects unknown paymentSystemId with a clear "not configured" message
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { setPaymentMethodTool } from '../set-payment-method'
import { makeFakeToolContext, seedCart } from './fakes'

describe('set_payment_method', () => {
  it('records the chosen system and reports the cart total', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    deps.checkout.seedPaymentSystems(deps.ctx.orderFormId!, [
      { id: 47, stringId: '47', name: 'Cash', groupName: 'cashPaymentGroup' },
    ])

    const effect = await setPaymentMethodTool.execute(
      { paymentSystemId: '47' },
      deps.ctx
    )

    assert.match(effect.result, /Payment method set/)
    assert.match(effect.result, /50\.00/)
    assert.equal(effect.cartUpdated, true)
  })

  it('surfaces a graceful error when paymentSystemId is missing', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])

    const effect = await setPaymentMethodTool.execute({}, deps.ctx)

    assert.match(effect.result, /missing paymentSystemId/)
  })

  it('surfaces a graceful error when there is no active cart', async () => {
    const deps = makeFakeToolContext({ orderFormId: null })

    const effect = await setPaymentMethodTool.execute(
      { paymentSystemId: '47' },
      deps.ctx
    )

    assert.match(effect.result, /no active cart/i)
  })

  it('rejects unknown paymentSystemId with a clear "not configured" message', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    // No payment systems seeded; the id will not resolve.

    const effect = await setPaymentMethodTool.execute(
      { paymentSystemId: '999' },
      deps.ctx
    )

    assert.match(effect.result, /not configured/)
    assert.match(effect.result, /list_payment_methods/)
  })
})
