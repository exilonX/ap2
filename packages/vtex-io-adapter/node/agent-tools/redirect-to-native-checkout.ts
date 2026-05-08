/**
 * redirect_to_native_checkout — Path-A handoff to VTEX native checkout.
 *
 * Sister tool to `create_cart_mandate`. Both sign a CartMandate over
 * the current cart; this one ALSO returns a VTEX native checkout URL
 * for merchants who prefer the native VTEX UX over the in-chat
 * payment flow.
 *
 * Per CONTEXT.md "Checkout handoff", Path A loses observability after
 * the redirect — drift detection isn't available downstream — but the
 * mandate is still signed for audit/dispute purposes.
 *
 * Logic mirrors the legacy `case 'checkout':` block in chat.ts before
 * Issue 03 deleted it.
 */

import { Cart } from '../cart/cart'
import { OrderFormSubstitutedError } from '../cart/errors'
import { buildMerchantIdentity, resolveMerchantDomain } from '../handlers/did'
import { MandateOrchestration } from '../mandates/mandate-orchestration'
import type { AgentTool, ToolContext, ToolEffect } from './types'

const definition = {
  name: 'redirect_to_native_checkout',
  description:
    "Sign an AP2 CartMandate and return a link to VTEX's native checkout page (Path A). Use ONLY when the customer explicitly asks to checkout on the standard VTEX UI rather than paying in chat.",
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
    source: 'agent-tool:redirect_to_native_checkout',
  })

  const host = resolveMerchantDomain((ctx as unknown) as Context)
  const checkoutUrl = `https://${host}/checkout/?orderFormId=${encodeURIComponent(
    ctx.orderFormId
  )}#/cart`

  const retrievalUrl = `https://${host}/_v/acg/mandates/${bundle.mandateId}`
  const didDocumentUrl = `https://${host}/_v/acg/.well-known/did.json`

  return {
    result: [
      `Cart total ${snapshot.total} ${snapshot.currency} (${snapshot.itemCount} items).`,
      `Mandate ${bundle.mandateId} signed for audit.`,
      `Continue to VTEX native checkout: ${checkoutUrl}`,
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

export const redirectToNativeCheckoutTool: AgentTool = { definition, execute }
