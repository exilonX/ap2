/**
 * send_payment_info tests.
 *
 * Covers:
 *   - happy path: forwards payment to gateway, surfaces text
 *   - preconditions: open transaction in customData, payment data present
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { sendPaymentInfoTool } from '../send-payment-info'
import { saveOrderFormState } from '../../mandates/mandate-orchestration'
import { makeFakeToolContext, seedCart } from './fakes'

describe('send_payment_info', () => {
  it('forwards payment details to the gateway and reports success', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    await deps.checkout.addPaymentData(deps.ctx.orderFormId!, {
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
    await saveOrderFormState(deps.vbase, deps.ctx.orderFormId!, {
      cartMandateId: 'mandate-x',
      transactionId: 'tx-1',
      orderGroup: 'og-1',
    })

    const effect = await sendPaymentInfoTool.execute({}, deps.ctx)

    assert.match(effect.result, /Payment information sent/)
    assert.equal(deps.payments.sendPaymentsCalls.length, 1)
    assert.equal(deps.payments.sendPaymentsCalls[0].transactionId, 'tx-1')
    // paymentSystem is a STRING on the gateway request body — matches what
    // VTEX echoes back in merchantTransactions[].payments[].paymentSystem.
    assert.equal(
      deps.payments.sendPaymentsCalls[0].payments[0].paymentSystem,
      '47'
    )
    assert.equal(deps.payments.sendPaymentsCalls[0].payments[0].value, 5000)
  })

  it('errors when no open transaction is recorded', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    // No state write — no transactionId on record.

    const effect = await sendPaymentInfoTool.execute({}, deps.ctx)

    assert.match(effect.result, /no open transaction/i)
    assert.match(effect.result, /place_order/)
  })

  it('errors when paymentData was cleared between place_order and send_payment_info', async () => {
    const deps = makeFakeToolContext()

    seedCart(deps, [{ sku: '1', quantity: 1, unitPriceCents: 5000 }])
    await saveOrderFormState(deps.vbase, deps.ctx.orderFormId!, {
      cartMandateId: 'mandate-x',
      transactionId: 'tx-1',
      orderGroup: 'og-1',
    })
    // No payment data written.

    const effect = await sendPaymentInfoTool.execute({}, deps.ctx)

    assert.match(effect.result, /paymentData was reset/i)
  })
})
