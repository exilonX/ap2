/**
 * list_payment_methods — surface the merchant's configured payment systems.
 *
 * The agent calls this just before set_payment_method to discover which
 * payment methods the merchant has actually configured on this sales
 * channel. The list comes straight from VTEX (`orderForm.paymentData.
 * paymentSystems`) — no merchant-side configuration, no merchant-side
 * invention.
 *
 * If the merchant profile sets `preferredPaymentMethods`, those ids are
 * bubbled to the top so the LLM picks them first when the user doesn't
 * express a preference.
 *
 * The method names are also returned as `suggestions[]` so the widget
 * can render them as quick-reply options.
 */

import { Cart } from '../cart/cart'
import type { PaymentMethodOption } from '../cart/cart'
import { OrderFormSubstitutedError } from '../cart/errors'
import type { AgentTool, ToolContext, ToolEffect } from './types'

const definition = {
  name: 'list_payment_methods',
  description:
    'List the payment methods the merchant has configured for this cart. Call this before set_payment_method so the user can pick from real options (Cash, Card, etc.) rather than guessing. Does not modify the cart.',
  parameters: { type: 'object' as const, properties: {} },
}

function reorderByPreference(
  methods: PaymentMethodOption[],
  preferred?: string[]
): PaymentMethodOption[] {
  if (!preferred || preferred.length === 0) return methods
  const preferredSet = new Set(preferred)
  const head: PaymentMethodOption[] = []

  // Walk `preferred` in order so the first preferred id wins the top slot.
  for (const id of preferred) {
    const m = methods.find((x) => x.id === id)

    if (m) head.push(m)
  }

  const tail = methods.filter((m) => !preferredSet.has(m.id))

  return [...head, ...tail]
}

async function execute(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolEffect> {
  if (!ctx.orderFormId) {
    return {
      result:
        'ERROR: no active cart. Add an item before listing payment methods.',
    }
  }

  const cart = new Cart({ checkout: ctx.clients.checkout })
  let methods: PaymentMethodOption[]

  try {
    methods = await cart.getAvailablePaymentSystems(ctx.orderFormId)
  } catch (err) {
    if (err instanceof OrderFormSubstitutedError) {
      return {
        result:
          'ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.',
      }
    }

    throw err
  }

  if (methods.length === 0) {
    return {
      result:
        'No payment methods are configured on this store. The merchant needs to enable at least one payment system in VTEX admin.',
    }
  }

  const preferred = (ctx.config as { preferredPaymentMethods?: string[] })
    .preferredPaymentMethods

  const ordered = reorderByPreference(methods, preferred)

  const lines = ordered.map((m) => `- ${m.name} (id: ${m.id})`).join('\n')

  return {
    result: [
      `Available payment methods (${ordered.length}):`,
      lines,
      `Pass the chosen method's id to set_payment_method.`,
      `The widget renders these as pill buttons automatically — do NOT re-list them in plain text.`,
    ].join('\n'),
    // Surface both for the LLM (suggestions = quick-reply chips on
    // surfaces without a dedicated payment-method renderer) and for the
    // widget (paymentMethods = structured pill buttons it can render
    // with icons, click-to-pick semantics).
    suggestions: ordered.map((m) => m.name),
    paymentMethods: ordered.map((m) => ({
      id: m.id,
      name: m.name,
      group: m.group,
    })),
  }
}

export const listPaymentMethodsTool: AgentTool = { definition, execute }
