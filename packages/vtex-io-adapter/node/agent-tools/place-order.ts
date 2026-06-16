/* eslint-disable no-console -- demo-quality stdout instrumentation; tracked by issue 0005 */
/**
 * place_order — entry point of the headless checkout flow.
 *
 * This tool does THREE things in one call, all logged step-by-step
 * with the `[ACG place_order]` tag so the operator can see exactly
 * which VTEX endpoints are hit and in what order:
 *
 *   1. Sign the AP2 CartMandate (if one is not already in the per-
 *      orderForm VBase state record). This is the cryptographic
 *      commitment to the final cart state. Persisted to VBase under
 *      `acg-mandates/<mandateId>` and the id is recorded in
 *      `acg-orderform-state/<orderFormId>` so downstream tools can
 *      rediscover it.
 *   2. Create a real VTEX transaction by POSTing the orderForm to
 *      `/api/checkout/pub/orderForm/:id/transaction` with the
 *      mandate id as `referenceId`. Returns a real `orderGroup`
 *      that appears in the VTEX OMS admin.
 *   3. Persist the resulting `transactionId` + `orderGroup` back
 *      into the same VBase state record so `send_payment_info` and
 *      `authorize_transaction` can read them without threading state
 *      through the LLM's turn history.
 *
 * After this tool returns, the chain is:
 *   send_payment_info  → POST {account}.vtexpayments.com.br/.../payments
 *   authorize_transaction → POST {account}.vtexpayments.com.br/.../authorization-request
 *
 * Auto-signing (step 1) is what lets place_order be a true single
 * entry point — the LLM does not need to remember to call a separate
 * `create_cart_mandate` first. The legacy `checkoutInChat` /
 * `executePayment` mock surface is intentionally NOT a fallback here.
 *
 * Why VBase, not orderForm.customData: VTEX Checkout's customData
 * requires the namespace to be pre-registered as a custom app and
 * only exposes a per-field PUT — the whole-namespace PUT we'd want
 * returns 404. VBase needs no registration and gives us atomic
 * read/write of the whole record.
 */

import { Cart } from '../cart/cart'
import { buildMerchantIdentity, resolveMerchantDomain } from '../handlers/did'
import {
  MandateOrchestration,
  readOrderFormState,
  saveOrderFormState,
  saveOrderGroupMandateIndex,
} from '../mandates/mandate-orchestration'
import type { Ap2CustomData } from '../mandates/mandate-orchestration'
import type { AgentTool, ToolContext, ToolEffect } from './types'

const TAG = '[ACG place_order]'

const definition = {
  name: 'place_order',
  description:
    "Entry point of the headless checkout flow. Signs the AP2 CartMandate over the current cart AND creates a real VTEX transaction for it. Requires items, client profile, shipping, and a selected payment method. Returns the order's orderGroup. After this call, run send_payment_info then authorize_transaction to finalize. Use this — NOT the legacy iframe checkout — to create a real order.",
  parameters: { type: 'object' as const, properties: {} },
}

async function execute(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolEffect> {
  console.log(`${TAG} start: orderFormId=${ctx.orderFormId ?? '<none>'}`)

  if (!ctx.orderFormId) {
    console.log(`${TAG} EXIT: no orderFormId`)

    return {
      result:
        'ERROR: no active cart. Add items and prepare the checkout first.',
    }
  }

  // ── 1. GET orderForm — preconditions + read customData.ap2 ──
  console.log(`${TAG} → GET /api/checkout/pub/orderForm/${ctx.orderFormId}`)
  const orderForm = await ctx.clients.checkout.getOrderForm(ctx.orderFormId)

  console.log(
    `${TAG} ← orderForm: orderFormId=${orderForm.orderFormId} items=${
      orderForm.items.length
    } value=${orderForm.value} status=${
      orderForm.paymentData?.updateStatus ?? 'unknown'
    } payments.length=${orderForm.paymentData?.payments?.length ?? 0}`
  )

  if (orderForm.orderFormId !== ctx.orderFormId) {
    console.log(
      `${TAG} EXIT: orderFormId mismatch (requested=${ctx.orderFormId} got=${orderForm.orderFormId})`
    )

    return {
      result:
        'ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.',
    }
  }

  if (orderForm.items.length === 0) {
    console.log(`${TAG} EXIT: cart empty`)

    return {
      result:
        'ERROR: cart is empty. Add at least one item before placing the order.',
    }
  }

  if (!orderForm.clientProfileData?.email) {
    console.log(`${TAG} EXIT: clientProfileData missing`)

    return {
      result:
        'ERROR: customer profile missing. Call set_customer_profile before placing the order.',
    }
  }

  const hasShipping =
    !!orderForm.shippingData?.address ||
    (orderForm.shippingData?.selectedAddresses?.length ?? 0) > 0

  if (!hasShipping) {
    console.log(`${TAG} EXIT: shippingData missing`)

    return {
      result:
        'ERROR: shipping address missing. Call set_shipping_address before placing the order.',
    }
  }

  const payments = orderForm.paymentData?.payments ?? []

  if (payments.length === 0) {
    console.log(`${TAG} EXIT: paymentData empty`)

    return {
      result:
        'ERROR: payment method not set. Call list_payment_methods then set_payment_method before placing the order.',
    }
  }

  console.log(
    `${TAG} preconditions OK: items=${orderForm.items.length} profile.email=${
      orderForm.clientProfileData?.email
    } shipping=ok payments=${JSON.stringify(payments)}`
  )

  // ── 1a. Diagnose + self-heal value drift between orderForm and payment.
  //
  // ORD009 ("Valoarea de plată este diferită de valoarea comenzii") fires
  // when VTEX's transaction creator sees a delta between `orderForm.value`
  // and `sum(payments[].value)`. The classic cause is shipping / promotion
  // recalculation BETWEEN the addPaymentData call and the placeOrder call:
  // payment.value snapshots the cart total at one moment, the cart total
  // shifts after, and ORD009 fires.
  //
  // To self-heal we recompute sum(payments[].value) and, if it doesn't
  // match orderForm.value, call addPaymentData once more to re-set the
  // single payment to the correct value before posting /transaction.
  // Multi-payment (split-pay) carts intentionally fall through — re-balancing
  // a split is the LLM's job, not the merchant's.
  const totalizers = orderForm.totalizers ?? []

  console.log(
    `${TAG} cart breakdown: value=${
      orderForm.value
    } totalizers=${JSON.stringify(
      totalizers.map((t) => ({ id: t.id, name: t.name, value: t.value }))
    )}`
  )

  const itemPriceBreakdown = orderForm.items.map((it, i) => ({
    i,
    sku: it.id,
    qty: it.quantity,
    sellingPrice: it.sellingPrice,
    listPrice: it.listPrice,
    price: it.price,
    lineTotal: it.sellingPrice * it.quantity,
  }))

  console.log(`${TAG} item pricing: ${JSON.stringify(itemPriceBreakdown)}`)

  const paymentValueSum: number = payments.reduce(
    (s: number, p) => s + Number((p as { value?: unknown }).value ?? 0),
    0
  )

  console.log(
    `${TAG} payment value sum=${paymentValueSum} vs orderForm.value=${
      orderForm.value
    } delta=${orderForm.value - paymentValueSum}`
  )

  if (paymentValueSum !== orderForm.value && payments.length === 1) {
    const stale = payments[0] as Record<string, unknown>

    console.log(
      `${TAG} ⚠ value drift detected — re-setting payment to orderForm.value=${orderForm.value} (was ${paymentValueSum})`
    )

    try {
      await ctx.clients.checkout.addPaymentData(ctx.orderFormId, {
        payments: [
          {
            paymentSystem: String(stale.paymentSystem),
            paymentSystemName: String(stale.paymentSystemName ?? ''),
            group: String(stale.group ?? ''),
            value: orderForm.value,
            referenceValue: orderForm.value,
            installments: Number(stale.installments ?? 1),
            installmentsInterestRate: Number(
              stale.installmentsInterestRate ?? 0
            ),
            hasDefaultBillingAddress: false,
          },
        ],
      })
      console.log(`${TAG} ← payment re-synced to ${orderForm.value}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      console.warn(
        `${TAG} ⚠ payment re-sync failed (will proceed and let VTEX decide): ${msg}`
      )
    }
  } else if (paymentValueSum !== orderForm.value) {
    console.warn(
      `${TAG} ⚠ value drift detected but ${payments.length} payments — leaving split untouched, VTEX may reject`
    )
  }

  console.log(`${TAG} → vbase.read acg-orderform-state/${ctx.orderFormId}`)
  const existing = await readOrderFormState(ctx.clients.vbase, ctx.orderFormId)

  console.log(`${TAG} ← orderForm state (pre) = ${JSON.stringify(existing)}`)

  // ── 1b. Sign the AP2 CartMandate inline if one is not already
  // recorded on this orderForm's state. This collapses the old
  // `create_cart_mandate` step into place_order so the LLM has a
  // single entry point and cannot skip signing.
  let ap2: Ap2CustomData = existing
  // Captured during the inline-sign branch and forwarded into the
  // orderGroup index. When ap2 was already populated by an earlier
  // create_cart_mandate call, the index entry omits signedBy — callers
  // can re-derive it from the EvidenceBundle if needed.
  let signedByFromInlineSign: string | undefined

  if (!ap2.cartMandateId) {
    console.log(
      `${TAG} no cartMandateId on orderForm state — signing inline (auto-mandate path)`
    )

    const cart = new Cart({ checkout: ctx.clients.checkout })

    console.log(
      `${TAG} → GET /api/checkout/pub/orderForm/${ctx.orderFormId} (snapshot for signing)`
    )
    const snapshot = await cart.getCart(ctx.orderFormId)

    console.log(
      `${TAG} ← cart snapshot for signing: items=${snapshot.items.length} total=${snapshot.total} ${snapshot.currency}`
    )

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
      source: 'agent-tool:place_order:auto-sign',
    })

    console.log(
      `${TAG} ← mandate signed inline: mandateId=${bundle.mandateId} signedBy=${
        bundle.signedBy
      } cartHash=${bundle.cartHash.slice(0, 16)}…`
    )

    const host = resolveMerchantDomain((ctx as unknown) as Context)

    ap2 = {
      cartMandateId: bundle.mandateId,
      didDocumentUrl: `https://${host}/_v/acg/.well-known/did.json`,
      signedAt: bundle.signedAt,
    }
    signedByFromInlineSign = bundle.signedBy

    console.log(
      `${TAG} → vbase.save acg-orderform-state/${ctx.orderFormId} { cartMandateId=${bundle.mandateId} }`
    )
    try {
      await saveOrderFormState(ctx.clients.vbase, ctx.orderFormId, ap2)
      console.log(`${TAG} ← orderForm state persisted`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      console.warn(
        `${TAG} ⚠ pre-transaction state write failed: ${msg} — proceeding with in-memory mandate id`
      )
    }
  } else {
    console.log(
      `${TAG} re-using existing cartMandateId=${ap2.cartMandateId} (skipping inline sign)`
    )
  }

  // Narrow ap2.cartMandateId to a non-nullable string for the rest of the
  // function. Both branches above guarantee it is set; this guard exists
  // only to satisfy the TypeScript compiler under strict null checks.
  const { cartMandateId } = ap2

  if (!cartMandateId) {
    console.log(`${TAG} EXIT: cartMandateId still missing after sign attempt`)

    return {
      result:
        'ERROR: failed to sign the CartMandate. Try again — if this persists, check the VBase + MerchantIdentity logs.',
    }
  }

  // ── 2. POST /transaction (the actual VTEX call that creates the order) ──
  //
  // Body MUST include value + referenceValue — VTEX defaults the
  // comparison-with-orderForm.value to 0 otherwise and rejects with
  // ORD009 regardless of the actual paymentData on the orderForm.
  console.log(
    `${TAG} → POST /api/checkout/pub/orderForm/${ctx.orderFormId}/transaction { referenceId=${cartMandateId}, value=${orderForm.value}, referenceValue=${orderForm.value} }`
  )

  const placedAt = Date.now()
  let placed

  try {
    placed = await ctx.clients.checkout.placeOrder(ctx.orderFormId, {
      referenceId: cartMandateId,
      value: orderForm.value,
      referenceValue: orderForm.value,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    console.log(
      `${TAG} ✗ placeOrder threw after ${Date.now() - placedAt}ms: ${msg}`
    )
    throw err
  }

  // VTEX's POST /transaction returns a FLAT shape — `id` at top level IS
  // the transactionId, and `merchantTransactions` (not `transactionData
  // .merchantTransactions`) is also at top level. We tolerate both
  // shapes here so the test fake's existing nested response keeps
  // working; live VTEX uses the flat form.
  const transactionId =
    placed.id ??
    placed.merchantTransactions?.[0]?.transactionId ??
    placed.transactionData?.merchantTransactions?.[0]?.transactionId

  const { orderGroup } = placed

  console.log(
    `${TAG} ← placeOrder ${
      Date.now() - placedAt
    }ms: orderGroup=${orderGroup} transactionId=${transactionId} receiverUri=${
      placed.receiverUri ?? '<none>'
    }`
  )

  if (!transactionId || !orderGroup) {
    // VTEX returns 200 + a `messages[]` array even when the transaction
    // is rejected (e.g. ORD009 — payment value mismatch). Surface those
    // messages to the operator instead of just "shape unexpected".
    const { messages } = placed as { messages?: Array<Record<string, unknown>> }

    if (Array.isArray(messages) && messages.length > 0) {
      const summary = messages
        .map(
          (m) =>
            `${String(m.code ?? '?')}:${String(m.text ?? '<no text>')}${
              m.status ? ` [${String(m.status)}]` : ''
            }`
        )
        .join(' | ')

      console.log(`${TAG} ✗ VTEX rejected the transaction: ${summary}`)
      console.log(
        `${TAG} full response: ${JSON.stringify(placed).slice(0, 800)}`
      )

      return {
        result: `ERROR: VTEX rejected the transaction — ${summary}. Check stdout logs for the full payload.`,
      }
    }

    console.log(
      `${TAG} EXIT: placeOrder response missing fields. Full response: ${JSON.stringify(
        placed
      ).slice(0, 500)}`
    )

    return {
      result: `ERROR: VTEX placeOrder did not return a transactionId or orderGroup. Response shape unexpected.`,
    }
  }

  // ── 3. vbase.save — persist transactionId + orderGroup + merchantName ──
  //
  // merchantName comes straight from VTEX's response so send_payment_info
  // can put the same string into its outbound `transaction.merchantName`
  // field. The fallback to `ctx.vtex.account.toUpperCase()` handles only
  // the unlikely case where the response omits merchantTransactions[].
  const merchantName =
    placed.merchantTransactions?.[0]?.merchantName ??
    ctx.vtex.account.toUpperCase()

  console.log(
    `${TAG} → vbase.save acg-orderform-state/${ctx.orderFormId} { ...ap2, transactionId=${transactionId}, orderGroup=${orderGroup}, merchantName=${merchantName} }`
  )

  try {
    await saveOrderFormState(ctx.clients.vbase, ctx.orderFormId, {
      ...ap2,
      transactionId,
      orderGroup,
      merchantName,
    })
    console.log(`${TAG} ← orderForm state persisted`)
  } catch (err) {
    // Soft failure: the order is already placed in VTEX. The next tool
    // can re-fetch from VBase or fall back to the placeOrder response.
    // Surfaced as a warning, not an error.
    const msg = err instanceof Error ? err.message : String(err)

    console.warn(
      `${TAG} ⚠ orderForm state write failed (order still placed): ${msg}`
    )
  }

  // ── 4. Index the mandate by orderGroup for the PPP connector ──
  //
  // The connector only knows orderId/orderGroup during its authorize
  // callback — not orderFormId. This second VBase write keyed by
  // orderGroup is what makes `GET /_v/acg/mandates/by-order/:orderGroup`
  // work. Soft failure: the order is real either way.
  console.log(
    `${TAG} → vbase.save acg-order-mandate-index/${orderGroup} { cartMandateId=${ap2.cartMandateId} }`
  )
  try {
    await saveOrderGroupMandateIndex(ctx.clients.vbase, orderGroup, {
      cartMandateId: ap2.cartMandateId!,
      didDocumentUrl: ap2.didDocumentUrl,
      signedAt: ap2.signedAt,
      signedBy: signedByFromInlineSign,
      transactionId,
    })
    console.log(`${TAG} ← orderGroup index persisted`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    console.warn(
      `${TAG} ⚠ orderGroup index write failed (order still placed): ${msg}`
    )
  }

  const cart = new Cart({ checkout: ctx.clients.checkout })
  const snapshot = await cart.getCart(ctx.orderFormId).catch(() => null)
  // VTEX's POST /transaction does NOT include `orders[]` (that's the GET
  // response shape) — fall back to orderForm.value (in cents) divided by
  // 100 for display purposes if the cart snapshot is also unavailable.
  const total =
    snapshot?.total ?? (placed.orders?.[0]?.value ?? orderForm.value) / 100

  const currency =
    snapshot?.currency ?? orderForm.storePreferencesData.currencyCode

  console.log(
    `${TAG} ✓ done: orderGroup=${orderGroup} total=${total.toFixed(
      2
    )} ${currency}`
  )

  return {
    result: [
      `Order ${orderGroup} created for ${total.toFixed(2)} ${currency}.`,
      `Call send_payment_info next to forward payment details to the gateway.`,
    ].join(' '),
  }
}

export const placeOrderTool: AgentTool = { definition, execute }
