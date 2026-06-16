/**
 * place_order tests.
 *
 * Covers:
 *   - happy path: returns orderGroup; transactionId + orderGroup persisted in VBase
 *   - preconditions: items / profile / shipping / payment
 *   - auto-mandate path: place_order signs and persists a mandate inline when none is on record
 *   - VTEX session reset returns a graceful error
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { placeOrderTool } from '../place-order'
import {
  MandateOrchestration,
  readOrderFormState,
  readOrderGroupMandateIndex,
  saveOrderFormState,
} from '../../mandates/mandate-orchestration'
import { MerchantIdentity } from '../../identity/merchant-identity'
import { VBaseKeyStore } from '../../identity/vbase-keystore'
import { makeFakeToolContext, seedCart } from './fakes'
import type { FakeToolDeps } from './fakes'

async function prepareReadyCart(
  deps: FakeToolDeps,
  opts: {
    withMandate?: boolean
    withPayment?: boolean
    withProfile?: boolean
    withShipping?: boolean
  } = {}
) {
  seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
  const orderFormId = deps.ctx.orderFormId!

  if (opts.withProfile !== false) {
    await deps.checkout.addClientProfileData(orderFormId, {
      email: 'shopper@example.com',
      firstName: 'A',
      lastName: 'B',
    })
  }

  if (opts.withShipping !== false) {
    await deps.checkout.addShippingData(orderFormId, {
      clearAddressIfPostalCodeNotFound: false,
      selectedAddresses: [
        {
          addressType: 'residential',
          receiverName: 'A B',
          postalCode: '10000',
          city: 'Bucharest',
          state: 'B',
          country: 'ROU',
          street: 'Some',
          number: '1',
          neighborhood: 'Center',
        },
      ],
      logisticsInfo: [
        {
          itemIndex: 0,
          selectedSla: 'Normal',
          selectedDeliveryChannel: 'delivery',
        },
      ],
    })
  }

  if (opts.withPayment !== false) {
    await deps.checkout.addPaymentData(orderFormId, {
      payments: [
        {
          paymentSystem: '47',
          paymentSystemName: 'Cash',
          group: 'cashPaymentGroup',
          value: 5000,
          installments: 1,
          referenceValue: 5000,
        },
      ],
    })
  }

  if (opts.withMandate !== false) {
    await saveOrderFormState(deps.vbase, orderFormId, {
      cartMandateId: 'mandate-test-1',
    })
  }
}

describe('place_order', () => {
  it('places the order and persists transactionId + orderGroup into VBase state', async () => {
    const deps = makeFakeToolContext()

    await prepareReadyCart(deps)

    const effect = await placeOrderTool.execute({}, deps.ctx)

    assert.match(effect.result, /Order og-\d+ created/)
    // VBase state carries the carry-fields for the next two tools.
    const ap2 = await readOrderFormState(deps.vbase, deps.ctx.orderFormId!)

    assert.ok(ap2.transactionId, 'transactionId persisted')
    assert.ok(ap2.orderGroup, 'orderGroup persisted')
    assert.equal(
      ap2.cartMandateId,
      'mandate-test-1',
      'original cartMandateId preserved'
    )
  })

  it('returns a complete MandateInfo with orderGroup + transactionId so the widget renders PlacedOrderConfirmation', async () => {
    const deps = makeFakeToolContext()

    await prepareReadyCart(deps)

    const effect = await placeOrderTool.execute({}, deps.ctx)

    assert.ok(effect.mandate, 'mandate envelope present')
    assert.equal(effect.mandate!.mandateId, 'mandate-test-1')
    assert.match(effect.mandate!.orderGroup ?? '', /^og-\d+$/)
    assert.match(effect.mandate!.transactionId ?? '', /^tx-\d+$/)
    // checkoutUrl points at the OMS admin URL so the widget badge
    // click-through lands on the real order.
    assert.match(effect.mandate!.checkoutUrl, /\/admin\/orders\/og-\d+-01$/)
    assert.equal(typeof effect.mandate!.total, 'number')
    assert.ok(effect.mandate!.total > 0)
  })

  it('writes the orderGroup → mandate index so the PPP connector can look it up', async () => {
    const deps = makeFakeToolContext()

    await prepareReadyCart(deps)

    await placeOrderTool.execute({}, deps.ctx)

    // The fake places an order with orderGroup of the form og-<n>.
    // We discover it via the orderForm state record (already verified
    // in the previous test) and assert the index entry mirrors it.
    const ap2 = await readOrderFormState(deps.vbase, deps.ctx.orderFormId!)
    const { orderGroup } = ap2

    assert.ok(orderGroup, 'orderGroup persisted on state record')

    const ref = await readOrderGroupMandateIndex(deps.vbase, orderGroup!)

    assert.ok(ref, 'index entry exists for orderGroup')
    assert.equal(ref!.cartMandateId, 'mandate-test-1')
    assert.equal(ref!.transactionId, ap2.transactionId)
  })

  it('uses the cartMandateId as VTEX referenceId', async () => {
    const deps = makeFakeToolContext()

    await prepareReadyCart(deps)

    // Spy on the fake's placeOrder by wrapping it.
    const originalPlaceOrder = deps.checkout.placeOrder.bind(deps.checkout)
    let capturedReferenceId: string | null = null

    type PlaceOrderArg = string | { referenceId: string; value: number }
    ;((deps.checkout as unknown) as {
      placeOrder: (
        orderFormId: string,
        input: PlaceOrderArg
      ) => Promise<unknown>
    }).placeOrder = async (orderFormId: string, input: PlaceOrderArg) => {
      capturedReferenceId =
        typeof input === 'string' ? input : input.referenceId

      return originalPlaceOrder(orderFormId, input)
    }

    await placeOrderTool.execute({}, deps.ctx)

    assert.equal(capturedReferenceId, 'mandate-test-1')
  })

  it('errors when no cart session is present', async () => {
    const deps = makeFakeToolContext({ orderFormId: null })
    const effect = await placeOrderTool.execute({}, deps.ctx)

    assert.match(effect.result, /no active cart/i)
  })

  it('errors when cart has no items', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [])
    const effect = await placeOrderTool.execute({}, deps.ctx)

    assert.match(effect.result, /cart is empty/i)
  })

  it('errors when client profile is missing', async () => {
    const deps = makeFakeToolContext()

    await prepareReadyCart(deps, { withProfile: false })
    const effect = await placeOrderTool.execute({}, deps.ctx)

    assert.match(effect.result, /customer profile missing/i)
  })

  it('errors when shipping address is missing', async () => {
    const deps = makeFakeToolContext()

    await prepareReadyCart(deps, { withShipping: false })
    const effect = await placeOrderTool.execute({}, deps.ctx)

    assert.match(effect.result, /shipping address missing/i)
  })

  it('errors when payment method has not been set', async () => {
    const deps = makeFakeToolContext()

    await prepareReadyCart(deps, { withPayment: false })
    const effect = await placeOrderTool.execute({}, deps.ctx)

    assert.match(effect.result, /payment method not set/i)
  })

  it('auto-signs a CartMandate inline when none is present on the VBase state record', async () => {
    const deps = makeFakeToolContext()

    await prepareReadyCart(deps, { withMandate: false })

    // Spy on placeOrder so we can read back the referenceId the
    // freshly-signed mandate id flowed through as.
    const originalPlaceOrder = deps.checkout.placeOrder.bind(deps.checkout)
    let capturedReferenceId: string | null = null

    type PlaceOrderArg = string | { referenceId: string; value: number }
    ;((deps.checkout as unknown) as {
      placeOrder: (
        orderFormId: string,
        input: PlaceOrderArg
      ) => Promise<unknown>
    }).placeOrder = async (orderFormId: string, input: PlaceOrderArg) => {
      capturedReferenceId =
        typeof input === 'string' ? input : input.referenceId

      return originalPlaceOrder(orderFormId, input)
    }

    const effect = await placeOrderTool.execute({}, deps.ctx)

    assert.match(effect.result, /Order og-\d+ created/)

    // A mandate was synthesized + persisted, NOT the placeholder under test.
    assert.ok(capturedReferenceId, 'placeOrder received a non-null referenceId')
    assert.match(
      capturedReferenceId!,
      /^mandate-/,
      'referenceId is a freshly-signed mandate id'
    )

    // VBase state now carries the auto-signed mandate AND the
    // transactionId / orderGroup carry-fields the next two tools read.
    const ap2 = await readOrderFormState(deps.vbase, deps.ctx.orderFormId!)

    assert.equal(ap2.cartMandateId, capturedReferenceId)
    assert.ok(ap2.transactionId, 'transactionId persisted')
    assert.ok(ap2.orderGroup, 'orderGroup persisted')

    // The auto-signed mandate is retrievable through VBase — i.e. the
    // sign-and-persist beat ran end-to-end, not a half-step.
    const identity = new MerchantIdentity({
      keyStore: new VBaseKeyStore(deps.vbase),
      domain: 'fakeacct.myvtex.com',
    })

    const orchestration = new MandateOrchestration({
      identity,
      vbase: deps.vbase,
    })

    const retrieved = await orchestration.retrieve(capturedReferenceId!)

    assert.ok(retrieved, 'auto-signed mandate persisted in VBase')
    assert.equal(retrieved!.mandateId, capturedReferenceId)

    // The orderGroup index entry carries signedBy from the inline-sign
    // bundle (the re-use branch leaves it undefined). This is the field
    // the PPP connector uses to fetch the merchant DID document.
    const ref = await readOrderGroupMandateIndex(deps.vbase, ap2.orderGroup!)

    assert.ok(ref, 'index entry exists for orderGroup')
    assert.equal(ref!.cartMandateId, capturedReferenceId)
    assert.ok(
      ref!.signedBy && ref!.signedBy.length > 0,
      'signedBy captured from inline-sign bundle'
    )
  })
})
