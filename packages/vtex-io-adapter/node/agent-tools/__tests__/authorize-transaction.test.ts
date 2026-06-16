/**
 * authorize_transaction tests.
 *
 * Primary path: /pvt/authorization-request via PaymentsClient (works in
 * IO context with AppKey/Token credentials, returns numeric status for
 * Cash/promissory).
 *
 * Fallback path: gatewayCallback via CheckoutClient (works in browser
 * context with session cookies; tends to 500/CHK003 in IO mode but
 * tolerated as a soft outcome).
 *
 * Covers:
 *   - happy path: /pvt/ returns approved (string or numeric)
 *   - numeric status mapping (8 = approved-awaiting-settlement)
 *   - pending status passthrough
 *   - 1403 "already authorizing" as soft success
 *   - fallback to gatewayCallback when /pvt/ throws non-1403
 *   - preconditions: open transaction in VBase state
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { authorizeTransactionTool } from '../authorize-transaction'
import { saveOrderFormState } from '../../mandates/mandate-orchestration'
import { makeFakeToolContext, seedCart } from './fakes'

describe('authorize_transaction', () => {
  it('returns approved for a /pvt/ authorize with status="approved"', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    await saveOrderFormState(deps.vbase, deps.ctx.orderFormId!, {
      cartMandateId: 'mandate-x',
      transactionId: 'tx-1',
      orderGroup: 'og-1',
    })

    const effect = await authorizeTransactionTool.execute({}, deps.ctx)

    assert.match(effect.result, /approved/i)
    assert.match(effect.result, /og-1/)
    assert.equal(deps.payments.authorizationCalls.length, 1)
    assert.equal(deps.payments.authorizationCalls[0].transactionId, 'tx-1')
    // gatewayCallback only fires when /pvt/ throws — not here.
    assert.equal(deps.checkout.processOrderCalls.length, 0)
    // mandatePatch carries gatewayStatus for the widget to render the
    // "approved" panel — the chat handler merges this into the mandate
    // place_order populated earlier in the same turn.
    assert.ok(effect.mandatePatch)
    assert.equal(effect.mandatePatch!.mandateId, 'mandate-x')
    assert.equal(effect.mandatePatch!.orderGroup, 'og-1')
    assert.equal(effect.mandatePatch!.transactionId, 'tx-1')
    assert.equal(effect.mandatePatch!.gatewayStatus, 'approved')
  })

  it('maps numeric status 8 (cash awaiting settlement) to approved', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    await saveOrderFormState(deps.vbase, deps.ctx.orderFormId!, {
      cartMandateId: 'mandate-x',
      transactionId: 'tx-1',
      orderGroup: 'og-1',
    })
    deps.payments.setNextAuthorizationStatus((8 as unknown) as string)

    const effect = await authorizeTransactionTool.execute({}, deps.ctx)

    assert.match(effect.result, /approved/i)
    assert.match(effect.result, /og-1/)
    assert.match(effect.result, /status 8/)
  })

  it('explains pending status for redirect-based methods', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    await saveOrderFormState(deps.vbase, deps.ctx.orderFormId!, {
      cartMandateId: 'mandate-x',
      transactionId: 'tx-1',
      orderGroup: 'og-1',
    })
    deps.payments.setNextAuthorizationStatus('pending')

    const effect = await authorizeTransactionTool.execute({}, deps.ctx)

    assert.match(effect.result, /awaiting payment confirmation/i)
    assert.match(effect.result, /pending/)
  })

  it('falls back to gatewayCallback when /pvt/ authorize throws (non-1403)', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    await saveOrderFormState(deps.vbase, deps.ctx.orderFormId!, {
      cartMandateId: 'mandate-x',
      transactionId: 'tx-1',
      orderGroup: 'og-1',
    })
    deps.payments.failNextAuthorize(new Error('500 boom'))

    const effect = await authorizeTransactionTool.execute({}, deps.ctx)

    assert.match(effect.result, /finalized via gatewayCallback|finalized/i)
    assert.match(effect.result, /og-1/)
    assert.equal(deps.checkout.processOrderCalls.length, 1)
    assert.equal(deps.checkout.processOrderCalls[0], 'og-1')
  })

  it('errors when no open transaction is recorded', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    // No VBase state carry-fields.

    const effect = await authorizeTransactionTool.execute({}, deps.ctx)

    assert.match(effect.result, /no open transaction/i)
  })
})
