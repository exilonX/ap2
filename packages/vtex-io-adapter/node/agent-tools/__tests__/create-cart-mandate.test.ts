/**
 * create_cart_mandate tests.
 *
 * Covers:
 *   - happy path: signs and returns a mandate envelope with valid fields
 *   - empty cart returns a graceful error message
 *   - missing orderFormId returns a graceful error message
 *   - resulting mandate verifies via `MandateOrchestration.retrieve` round-trip
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { createCartMandateTool } from '../create-cart-mandate'
import {
  MandateOrchestration,
  readOrderFormState,
} from '../../mandates/mandate-orchestration'
import { MerchantIdentity } from '../../identity/merchant-identity'
import { VBaseKeyStore } from '../../identity/vbase-keystore'
import { makeFakeToolContext, seedCart } from './fakes'

describe('create_cart_mandate', () => {
  it('signs a mandate for the current cart and returns the envelope', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: 'apple', quantity: 1, unitPriceCents: 5000 }])

    const effect = await createCartMandateTool.execute({}, deps.ctx)

    assert.ok(effect.mandate, 'mandate envelope present')
    assert.match(effect.mandate!.mandateId, /^mandate-/)
    assert.match(effect.mandate!.retrievalUrl, /\/_v\/acg\/mandates\/mandate-/)
    assert.match(effect.mandate!.didDocumentUrl, /\/.well-known\/did\.json$/)
    assert.equal(effect.mandate!.signedBy, 'did:web:fakeacct.myvtex.com')
    assert.match(effect.result, /Signed mandate mandate-/)
    assert.match(effect.result, /1 items/)
  })

  it('includes checkoutUrl + total + currency for the widget primary CTA', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: 'apple', quantity: 2, unitPriceCents: 5000 }])

    const effect = await createCartMandateTool.execute({}, deps.ctx)

    assert.ok(effect.mandate)
    // VTEX native checkout URL — same orderForm so the cart carries over via cookie + URL param.
    assert.match(
      effect.mandate!.checkoutUrl,
      /^https:\/\/fakeacct\.myvtex\.com\/checkout\/\?orderFormId=of-test-1#\/cart$/
    )
    // Total and currency come from the cart snapshot — anchors the cryptographic commitment to a visible amount in the badge button.
    assert.equal(typeof effect.mandate!.total, 'number')
    assert.ok(effect.mandate!.total > 0)
    assert.equal(typeof effect.mandate!.currency, 'string')
    assert.ok(effect.mandate!.currency.length > 0)
  })

  it('encodes the orderFormId in the checkoutUrl (defense against XSS via session id)', async () => {
    const deps = makeFakeToolContext({
      orderFormId: 'weird id with spaces&special?',
    })

    seedCart(deps, [{ sku: 'apple', quantity: 1, unitPriceCents: 5000 }])

    const effect = await createCartMandateTool.execute({}, deps.ctx)

    assert.ok(effect.mandate)
    // No raw spaces or query special chars leaked into the URL.
    assert.ok(!/\?orderFormId=weird id/.test(effect.mandate!.checkoutUrl))
    assert.match(effect.mandate!.checkoutUrl, /orderFormId=weird%20id/)
  })

  it('returns graceful error when the cart has no items', async () => {
    const deps = makeFakeToolContext()

    // seed with an empty cart
    seedCart(deps, [])

    const effect = await createCartMandateTool.execute({}, deps.ctx)

    assert.equal(effect.mandate, undefined)
    assert.match(effect.result, /empty/i)
  })

  it('returns graceful error when there is no orderFormId at all', async () => {
    const deps = makeFakeToolContext({ orderFormId: null })

    const effect = await createCartMandateTool.execute({}, deps.ctx)

    assert.equal(effect.mandate, undefined)
    assert.match(effect.result, /empty/i)
  })

  it('writes the mandate id into the per-orderForm VBase state record', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: 'apple', quantity: 1, unitPriceCents: 5000 }])

    const effect = await createCartMandateTool.execute({}, deps.ctx)

    assert.ok(effect.mandate)

    const ap2 = await readOrderFormState(deps.vbase, deps.ctx.orderFormId!)

    assert.equal(ap2.cartMandateId, effect.mandate!.mandateId)
    assert.equal(ap2.didDocumentUrl, effect.mandate!.didDocumentUrl)
    assert.equal(ap2.signedAt, effect.mandate!.signedAt)
  })

  it('persisted mandate is retrievable and verifies', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: 'banana', quantity: 2, unitPriceCents: 3000 }])

    const effect = await createCartMandateTool.execute({}, deps.ctx)

    assert.ok(effect.mandate)

    // Independent retrieval through the orchestration module verifies persistence.
    const identity = new MerchantIdentity({
      keyStore: new VBaseKeyStore(deps.vbase),
      domain: 'fakeacct.myvtex.com',
    })

    const orchestration = new MandateOrchestration({
      identity,
      vbase: deps.vbase,
    })

    const retrieved = await orchestration.retrieve(effect.mandate!.mandateId)

    assert.ok(retrieved, 'mandate persisted in vbase')
    assert.equal(retrieved!.cartHash, effect.mandate!.cartHash)

    const verification = await orchestration.verify(effect.mandate!.mandateId)

    assert.equal(verification.valid, true)
    assert.equal(verification.checks.signatureValid, true)
    assert.equal(verification.checks.hashMatches, true)
  })
})
