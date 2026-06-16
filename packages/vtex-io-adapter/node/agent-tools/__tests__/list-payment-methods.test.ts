/**
 * list_payment_methods tests.
 *
 * Covers:
 *   - happy path: returns normalized methods + suggestions
 *   - empty orderFormId surfaces a graceful error
 *   - no configured methods returns a clear "merchant needs to enable" message
 *   - preferredPaymentMethods (from profile) reorders the list
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { listPaymentMethodsTool } from '../list-payment-methods'
import { makeFakeToolContext, seedCart } from './fakes'

describe('list_payment_methods', () => {
  it('returns the configured payment methods as text + suggestions', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    deps.checkout.seedPaymentSystems(deps.ctx.orderFormId!, [
      { id: 47, stringId: '47', name: 'Cash', groupName: 'cashPaymentGroup' },
      {
        id: 2,
        stringId: '2',
        name: 'Visa',
        groupName: 'creditCardPaymentGroup',
        requiresAuthentication: true,
      },
    ])

    const effect = await listPaymentMethodsTool.execute({}, deps.ctx)

    assert.match(effect.result, /Cash/)
    assert.match(effect.result, /Visa/)
    assert.deepEqual(effect.suggestions, ['Cash', 'Visa'])
  })

  it('returns a graceful error when there is no active cart', async () => {
    const deps = makeFakeToolContext({ orderFormId: null })

    const effect = await listPaymentMethodsTool.execute({}, deps.ctx)

    assert.match(effect.result, /no active cart/i)
  })

  it('returns a "merchant needs to enable" message when no systems configured', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    // No seeded payment systems.

    const effect = await listPaymentMethodsTool.execute({}, deps.ctx)

    assert.match(effect.result, /No payment methods/i)
    assert.match(effect.result, /VTEX admin/)
  })

  it('reorders by preferredPaymentMethods when set on the profile', async () => {
    const deps = makeFakeToolContext({
      config: {
        accountMatches: ['fake'],
        industry: 'generic',
        currency: 'RON',
        locales: { default: 'en', available: ['en'] },
        brand: { name: 'F', tone: '' },
        llmContext: '',
        starters: { en: [] },
        strings: {
          en: {
            greeting: '',
            placeholder: '',
            headerTitle: '',
            headerStatus: '',
            errorConnection: '',
            poweredBy: '',
          },
        },
        // Prefer Visa over Cash even though VTEX listed Cash first.
        preferredPaymentMethods: ['2', '47'],
      } as never,
    })

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    deps.checkout.seedPaymentSystems(deps.ctx.orderFormId!, [
      { id: 47, stringId: '47', name: 'Cash', groupName: 'cashPaymentGroup' },
      {
        id: 2,
        stringId: '2',
        name: 'Visa',
        groupName: 'creditCardPaymentGroup',
      },
    ])

    const effect = await listPaymentMethodsTool.execute({}, deps.ctx)

    assert.deepEqual(effect.suggestions, ['Visa', 'Cash'])
  })
})
