/**
 * set_payment_method — record the chosen payment method on the cart.
 *
 * Step 5 in the VTEX headless checkout flow. Takes a paymentSystemId
 * that was surfaced by list_payment_methods (so we know it's configured
 * on this merchant). VTEX validates the id against its own
 * configured-systems list — passing an unknown id raises a clear error.
 *
 * The cart total at this point already includes shipping. Leaving
 * `installments` unspecified means "pay in one shot, no interest" —
 * the right default for the connector-less Cash / promissory path.
 */

import { Cart } from '../cart/cart'
import { OrderFormSubstitutedError } from '../cart/errors'
import type { AgentTool, ToolContext, ToolEffect } from './types'

interface SetPaymentMethodArgs {
  paymentSystemId?: string
  installments?: number
}

const definition = {
  name: 'set_payment_method',
  description:
    "Record the customer's chosen payment method on the cart. The paymentSystemId must come from list_payment_methods — do not invent one. Returns the updated cart total.",
  parameters: {
    type: 'object' as const,
    properties: {
      paymentSystemId: {
        type: 'string',
        description:
          'Payment system id from list_payment_methods (e.g. "47" for Cash).',
      },
      installments: {
        type: 'number',
        description:
          'Number of installments. Defaults to 1 (single payment). Only relevant for installment-capable methods like credit card.',
      },
    },
    required: ['paymentSystemId'],
  },
}

async function execute(
  args: SetPaymentMethodArgs,
  ctx: ToolContext
): Promise<ToolEffect> {
  if (!args.paymentSystemId || typeof args.paymentSystemId !== 'string') {
    return {
      result:
        'ERROR: missing paymentSystemId. Call list_payment_methods first and pass the chosen method id.',
    }
  }

  if (!ctx.orderFormId) {
    return {
      result:
        'ERROR: no active cart. Add an item before setting a payment method.',
    }
  }

  const cart = new Cart({ checkout: ctx.clients.checkout })

  try {
    const updated = await cart.setPaymentData(ctx.orderFormId, {
      paymentSystemId: args.paymentSystemId,
      installments: args.installments,
    })

    return {
      result: [
        `Payment method set. Cart total is ${updated.total.toFixed(2)} ${
          updated.currency
        }.`,
        `Ready to place the order — call place_order next.`,
      ].join(' '),
      cartUpdated: true,
    }
  } catch (err) {
    if (err instanceof OrderFormSubstitutedError) {
      return {
        result:
          'ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.',
      }
    }

    const msg = err instanceof Error ? err.message : String(err)

    if (/not configured/.test(msg)) {
      return {
        result: `ERROR: paymentSystem ${args.paymentSystemId} is not configured on this store. Call list_payment_methods to see the available ones.`,
      }
    }

    throw err
  }
}

export const setPaymentMethodTool: AgentTool = { definition, execute }
