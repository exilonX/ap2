/**
 * create_cart_mandate — sign-only AP2 ceremony beat.
 *
 * The first beat of the headless-order flow:
 *   1. create_cart_mandate     ← this tool (signs, persists, writes to customData)
 *   2. list_payment_methods    (surfaces merchant's configured methods)
 *   3. set_payment_method      (records the choice on the cart)
 *   4. place_order             (creates a VTEX transaction)
 *   5. send_payment_info       (forwards to payments gateway)
 *   6. authorize_transaction   (finalizes)
 *
 * Operates on the current cart (orderFormId from cookie/header). Signs
 * via `MandateOrchestration.signAndPersist` and persists the resulting
 * mandate id into `orderForm.customData.ap2` so the downstream tools
 * (and the future PPP connector's `authorize` callback) can rediscover
 * it.
 *
 * The `result` text stays terse because the system prompt already
 * tells the LLM "structured fields appear automatically — don't repeat
 * them in text" (per ADR-0002).
 */

/* eslint-disable no-console -- demo-quality stdout instrumentation; tracked by issue 0005 */
import { Cart } from '../cart/cart'
import { OrderFormSubstitutedError } from '../cart/errors'
import { buildMerchantIdentity, resolveMerchantDomain } from '../handlers/did'
import {
  MandateOrchestration,
  saveOrderFormState,
} from '../mandates/mandate-orchestration'
import type { AgentTool, ToolContext, ToolEffect } from './types'

const TAG = '[ACG create_cart_mandate]'

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
  console.log(`${TAG} start: orderFormId=${ctx.orderFormId ?? '<none>'}`)

  if (!ctx.orderFormId) {
    console.log(`${TAG} EXIT: no orderFormId`)

    return { result: 'Your cart is empty. Add some products first.' }
  }

  const cart = new Cart({ checkout: ctx.clients.checkout })
  let snapshot

  console.log(
    `${TAG} → GET /api/checkout/pub/orderForm/${ctx.orderFormId} (snapshot for signing)`
  )
  try {
    snapshot = await cart.getCart(ctx.orderFormId)
    console.log(
      `${TAG} ← cart snapshot: items=${snapshot.items.length} total=${snapshot.total} ${snapshot.currency}`
    )
  } catch (err) {
    if (err instanceof OrderFormSubstitutedError) {
      console.log(`${TAG} EXIT: orderForm substituted by VTEX`)

      return {
        result:
          'ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.',
      }
    }

    const msg = err instanceof Error ? err.message : String(err)

    console.log(`${TAG} ✗ getCart threw: ${msg}`)
    throw err
  }

  if (snapshot.items.length === 0) {
    console.log(`${TAG} EXIT: cart empty`)

    return { result: 'Your cart is empty. Add some products first.' }
  }

  const identity = buildMerchantIdentity((ctx as unknown) as Context)
  const orchestration = new MandateOrchestration({
    identity,
    vbase: ctx.clients.vbase,
  })

  console.log(
    `${TAG} signing CartMandate (JCS + Ed25519) + persisting to VBase…`
  )
  const bundle = await orchestration.signAndPersist(snapshot, {
    orderFormId: ctx.orderFormId,
    source: 'agent-tool:create_cart_mandate',
  })

  console.log(
    `${TAG} ← mandate signed: mandateId=${bundle.mandateId} signedBy=${
      bundle.signedBy
    } cartHash=${bundle.cartHash.slice(0, 16)}…`
  )

  const host = resolveMerchantDomain((ctx as unknown) as Context)
  const retrievalUrl = `https://${host}/_v/acg/mandates/${bundle.mandateId}`
  const didDocumentUrl = `https://${host}/_v/acg/.well-known/did.json`

  // Persist the mandate id into the per-orderForm VBase state record so
  // place_order (and the future PPP connector during its authorize
  // callback) can rediscover it without re-signing. Soft failure — the
  // mandate is still valid in VBase even if this auxiliary write fails.
  console.log(
    `${TAG} → vbase.save acg-orderform-state/${ctx.orderFormId} { cartMandateId=${bundle.mandateId} }`
  )
  try {
    await saveOrderFormState(ctx.clients.vbase, ctx.orderFormId, {
      cartMandateId: bundle.mandateId,
      didDocumentUrl,
      signedAt: bundle.signedAt,
    })
    console.log(
      `${TAG} ← orderForm state persisted (place_order will read this)`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    console.warn(
      `${TAG} ⚠ orderForm state write failed: ${msg} — mandate still in VBase but place_order will not find it`
    )
  }

  // Same shape used by redirect_to_native_checkout. The widget renders this as
  // the primary CTA on MandateBadge and same-tab navigates the user to VTEX
  // native checkout. The cookie-bound orderForm session is preserved across
  // the handoff so the cart appears identical on both sides.
  const checkoutUrl = `https://${host}/checkout/?orderFormId=${encodeURIComponent(
    ctx.orderFormId
  )}#/cart`

  console.log(`${TAG} ✓ done: mandateId=${bundle.mandateId}`)

  return {
    result: [
      `Signed mandate ${bundle.mandateId} for ${snapshot.itemCount} items, total ${snapshot.total} ${snapshot.currency}.`,
      `Call list_payment_methods next to surface the merchant's configured payment methods.`,
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
