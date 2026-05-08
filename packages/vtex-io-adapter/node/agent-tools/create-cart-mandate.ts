/**
 * create_cart_mandate — sign-only AP2 ceremony beat.
 *
 * The first of the three demo-recordable AP2 beats:
 *   1. create_cart_mandate     ← this tool
 *   2. (user reviews; mandate badge shows in widget)
 *   3. execute_payment(mandateId)
 *
 * Operates on the current cart (orderFormId from cookie/header). Signs
 * via `MandateOrchestration.signAndPersist` — same path the legacy
 * `checkout` tool used, but stripped of the checkout-link return value.
 *
 * The `result` text stays terse because the system prompt already
 * tells the LLM "structured fields appear automatically — don't repeat
 * them in text" (per ADR-0002).
 */

import { Cart } from '../cart/cart'
import { OrderFormSubstitutedError } from '../cart/errors'
import { buildMerchantIdentity, resolveMerchantDomain } from '../handlers/did'
import { MandateOrchestration } from '../mandates/mandate-orchestration'
import type { AgentTool, ToolContext, ToolEffect } from './types'

const definition = {
  name: 'create_cart_mandate',
  description:
    'Sign an AP2 CartMandate over the current cart. The merchant cryptographically commits to the cart contents and price. Returns a mandate id and proof URL. Use as the first step of checkout when the customer wants to pay.',
  parameters: { type: 'object' as const, properties: {} },
}

async function execute(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolEffect> {
  if (!ctx.orderFormId) {
    return { result: 'Your cart is empty. Add some products first.' }
  }

  const cart = new Cart({ checkout: ctx.clients.checkout })
  let snapshot

  try {
    snapshot = await cart.getCart(ctx.orderFormId)
  } catch (err) {
    if (err instanceof OrderFormSubstitutedError) {
      return {
        result:
          'ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.',
      }
    }

    throw err
  }

  if (snapshot.items.length === 0) {
    return { result: 'Your cart is empty. Add some products first.' }
  }

  const identity = buildMerchantIdentity((ctx as unknown) as Context)
  const orchestration = new MandateOrchestration({
    identity,
    vbase: ctx.clients.vbase,
  })

  const bundle = await orchestration.signAndPersist(snapshot, {
    orderFormId: ctx.orderFormId,
    source: 'agent-tool:create_cart_mandate',
  })

  const host = resolveMerchantDomain((ctx as unknown) as Context)
  const retrievalUrl = `https://${host}/_v/acg/mandates/${bundle.mandateId}`
  const didDocumentUrl = `https://${host}/_v/acg/.well-known/did.json`
  // Same shape used by redirect_to_native_checkout. The widget renders this as
  // the primary CTA on MandateBadge and same-tab navigates the user to VTEX
  // native checkout. The cookie-bound orderForm session is preserved across
  // the handoff so the cart appears identical on both sides.
  const checkoutUrl = `https://${host}/checkout/?orderFormId=${encodeURIComponent(
    ctx.orderFormId
  )}#/cart`

  return {
    result: [
      `Signed mandate ${bundle.mandateId} for ${snapshot.itemCount} items, total ${snapshot.total} ${snapshot.currency}.`,
      `Pass this mandateId to execute_payment when the customer pays.`,
    ].join(' '),
    mandate: {
      mandateId: bundle.mandateId,
      retrievalUrl,
      cartHash: bundle.cartHash,
      signedBy: bundle.signedBy,
      signedAt: bundle.signedAt,
      didDocumentUrl,
      checkoutUrl,
      total: snapshot.total,
      currency: snapshot.currency,
    },
  }
}

export const createCartMandateTool: AgentTool = { definition, execute }
