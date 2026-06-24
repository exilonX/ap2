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
import { formatCustomerProfile, formatShippingAddress } from '../mappers/cart'
import { buildMerchantIdentity, resolveMerchantDomain } from '../handlers/did'
import {
  MandateOrchestration,
  readOrderFormState,
  saveOrderFormState,
  saveOrderGroupMandateIndex,
} from '../mandates/mandate-orchestration'
import type { Ap2CustomData } from '../mandates/mandate-orchestration'
import { PaymentOrchestration } from '../payments/payment-orchestration'
import { VBaseKeyStore } from '../identity/vbase-keystore'
import {
  MockCredentialsProvider,
  MockPaymentNetwork,
} from '../mock-payment-network'
import type { CartMandate, VerificationChecks } from '../core'
import type { AgentTool, ToolContext, ToolEffect } from './types'

const TAG = '[ACG place_order]'

// Mock CP + Network live under the same Adapter host as the merchant
// (so their DID documents resolve via /_v/acg/mock-{cp,network}/...),
// each with its own VBase keypair bucket. Mirrors handlers/payment.ts.
const MOCK_CP_BUCKET = 'acg-mock-cp'
const MOCK_CP_KEY = 'cp-did'
const MOCK_NETWORK_BUCKET = 'acg-mock-network'
const MOCK_NETWORK_KEY = 'network-did'

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
    console.log(
      `${TAG} EXIT: clientProfileData missing — clientProfileData=${JSON.stringify(
        orderForm.clientProfileData ?? null
      )} messages=${JSON.stringify(
        (orderForm as { messages?: unknown }).messages ?? []
      )}`
    )

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
      // Re-set through Cart.setPaymentData (NOT a hand-rolled addPaymentData)
      // so the buyer-identity block (firstName/lastName/document/
      // documentType) is re-injected from clientProfileData. The previous
      // hand-rolled re-set copied only paymentSystem/name/group from the
      // stale echo and silently stripped buyer identity — which made VTEX
      // render the gateway payment as "Fără denumire" (no name) whenever
      // value-drift fired between set_payment_method and place_order.
      const reSyncCart = new Cart({ checkout: ctx.clients.checkout })

      await reSyncCart.setPaymentData(ctx.orderFormId, {
        paymentSystemId: String(stale.paymentSystem),
        installments: Number(stale.installments ?? 1),
        value: orderForm.value,
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

  // ── 1a. Idempotency backstop (cross-replica safe). ──
  //
  // The widget Pay-Now orchestrator guards double-placement with an
  // in-process Set, but VTEX IO runs this service across many replicas
  // (service.json: minReplicas 2 × workers 4 = 8 processes at the floor)
  // with no sticky routing, so two near-simultaneous Pay-Now turns for the
  // same orderFormId can land on DIFFERENT replicas and both reach here. If
  // a prior placement already wrote transactionId + orderGroup to this
  // orderForm's state, the order EXISTS — return it idempotently instead of
  // re-signing a mandate and POSTing a second /transaction (which would
  // create a duplicate real order). This is the durable backstop the
  // in-memory lock cannot provide; it covers every caller (widget
  // orchestrator AND the LLM tool loop), not just the locked path.
  if (existing.transactionId && existing.orderGroup) {
    console.log(
      `${TAG} EXIT(idempotent): order already placed — orderGroup=${existing.orderGroup} transactionId=${existing.transactionId}; not re-placing`
    )

    return {
      result: `Order ${existing.orderGroup} was already placed for this cart — returning the existing transaction, no duplicate created. Proceed with send_payment_info / authorize_transaction.`,
      checkoutState: {
        transactionId: existing.transactionId,
        orderGroup: existing.orderGroup,
        merchantName: existing.merchantName ?? ctx.vtex.account.toUpperCase(),
        cartMandateId: existing.cartMandateId,
      },
    }
  }

  // ── 1b. Sign the AP2 CartMandate inline if one is not already
  // recorded on this orderForm's state. This collapses the old
  // `create_cart_mandate` step into place_order so the LLM has a
  // single entry point and cannot skip signing.
  let ap2: Ap2CustomData = existing
  // Captured during the inline-sign branch and forwarded into the
  // orderGroup index AND the MandateInfo surfaced to the widget. When
  // ap2 was already populated by an earlier create_cart_mandate call,
  // we recover signedBy + cartHash by retrieving the EvidenceBundle.
  let signedByFromInlineSign: string | undefined
  let cartHashFromInlineSign: string | undefined
  // The signed CartMandate object — needed by the AP2 ceremony below.
  // Captured from the inline-sign bundle, or retrieved for the re-use path.
  let cartMandateObj: CartMandate | undefined

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
    cartHashFromInlineSign = bundle.cartHash
    cartMandateObj = bundle.cartMandate

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

    // CHK0087 — "authentication required to use a new address". VTEX
    // rejects the anonymous /transaction when the orderForm's profile or
    // address requires an authenticated shopper session. The usual trigger
    // is a customer email that is a REGISTERED account on this store, or a
    // non-disposable new address. Surface a clear, actionable message
    // instead of letting a 500 + stack trace reach the iframe.
    const errResponse = (err as {
      response?: { status?: number; headers?: Record<string, string> }
    }).response

    const vtexCode = errResponse?.headers?.['x-vtex-error-code']

    if (vtexCode === 'CHK0087' || errResponse?.status === 401) {
      console.log(
        `${TAG} EXIT: CHK0087 / 401 — order needs an authenticated session`
      )

      return {
        result:
          'ERROR: VTEX requires an authenticated session to place this order (CHK0087 — "authentication required to use a new address"). This usually means the customer email is a registered account on this store. Use a guest email that is not registered, or place the order from an authenticated storefront session.',
      }
    }

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

  // ── 5. Build MandateInfo for the widget badge ──
  //
  // The inline-sign branch already has signedBy + cartHash. The re-use
  // branch (mandate created earlier by create_cart_mandate) needs to
  // retrieve the EvidenceBundle to recover them. Soft failure: a missing
  // signedBy degrades the badge UX but does not block the order.
  const host = resolveMerchantDomain((ctx as unknown) as Context)
  let signedBy = signedByFromInlineSign
  let cartHash = cartHashFromInlineSign

  if (!signedBy || !cartHash) {
    try {
      const identity = buildMerchantIdentity((ctx as unknown) as Context)
      const orchestration = new MandateOrchestration({
        identity,
        vbase: ctx.clients.vbase,
      })

      const retrieved = await orchestration.retrieve(cartMandateId)

      if (retrieved) {
        signedBy = signedBy ?? retrieved.signedBy
        cartHash = cartHash ?? retrieved.cartHash
        cartMandateObj = cartMandateObj ?? retrieved.cartMandate
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      console.warn(
        `${TAG} ⚠ mandate retrieve failed for badge metadata: ${msg}`
      )
    }
  }

  // checkoutUrl points at VTEX admin order URL — the user (in agent
  // demos) typically goes from the badge straight to the OMS view to
  // verify the order is real. Storefront-only flows can ignore it.
  const checkoutUrl = `https://${ctx.vtex.account}.myvtex.com/admin/orders/${orderGroup}-01`
  const retrievalUrl = `https://${host}/_v/acg/mandates/${cartMandateId}`
  const didDocumentUrl =
    ap2.didDocumentUrl ?? `https://${host}/_v/acg/.well-known/did.json`

  // ── AP2 three-party ceremony ───────────────────────────────────────
  //
  // The CartMandate is signed and the VTEX order is real. Now run the
  // CP + Network legs so the proof is the full three-party chain rather
  // than a CartMandate alone: the CP signs a PaymentMandate (binding the
  // cart hash + payment hash), the Network independently verifies the
  // seven checks and emits a signed PaymentReceipt. Both artifacts are
  // persisted and independently retrievable — this is what de-mocks the
  // iframe's seven checks and makes its PaymentMandate / PaymentReceipt
  // links real.
  //
  // Soft-failed: the VTEX order is already placed, so a ceremony hiccup
  // must never abort the tool. On failure the iframe falls back to a
  // basic confirmation (no seven-check panel).
  let paymentMandateUrl: string | undefined
  let paymentReceiptUrl: string | undefined
  let verificationChecks: VerificationChecks | undefined
  let paymentApprovalStatus: 'approved' | 'rejected' | undefined

  if (cartMandateObj) {
    try {
      const ceremonyIdentity = buildMerchantIdentity(
        (ctx as unknown) as Context
      )

      const cp = new MockCredentialsProvider({
        keyStore: new VBaseKeyStore(
          ctx.clients.vbase,
          MOCK_CP_BUCKET,
          MOCK_CP_KEY
        ),
        domain: `${host}:mock-cp`,
      })

      const network = new MockPaymentNetwork({
        keyStore: new VBaseKeyStore(
          ctx.clients.vbase,
          MOCK_NETWORK_BUCKET,
          MOCK_NETWORK_KEY
        ),
        domain: `${host}:mock-network`,
      })

      const paymentOrch = new PaymentOrchestration({
        identity: ceremonyIdentity,
        cp,
        network,
        vbase: ctx.clients.vbase,
      })

      console.log(
        `${TAG} running AP2 ceremony (CP signs PaymentMandate → Network verifies + signs PaymentReceipt)…`
      )
      const {
        paymentMandate,
        paymentReceipt,
      } = await paymentOrch.signAndSubmit({
        cartMandate: cartMandateObj,
        agentPresence: { agent_involved: true, human_present: true },
      })

      const pmId = paymentMandate.payment_mandate_contents.payment_mandate_id
      const rcptId = paymentReceipt.contents.receipt_id

      paymentMandateUrl = `https://${host}/_v/acg/payment-mandates/${pmId}`
      paymentReceiptUrl = `https://${host}/_v/acg/receipts/${rcptId}`
      verificationChecks = paymentReceipt.contents.verification_checks
      paymentApprovalStatus = paymentReceipt.contents.approval_status

      console.log(
        `${TAG} ← ceremony done: paymentMandateId=${pmId} receiptId=${rcptId} approval=${paymentApprovalStatus}`
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      console.warn(`${TAG} ⚠ AP2 ceremony failed (order still placed): ${msg}`)
    }
  }

  console.log(
    `${TAG} ✓ done: orderGroup=${orderGroup} total=${total.toFixed(
      2
    )} ${currency}`
  )

  // cartPreview is what the Claude Desktop iframe ceremony renders
  // (items + totals). The widget already reads the same field.
  // Synthesise from the snapshot we already fetched above for signing —
  // no extra VTEX call.
  const cartPreview = snapshot
    ? {
        items: snapshot.items.map((it) => ({
          sku: it.sku,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          totalPrice: it.totalPrice,
          image: it.image ?? '',
        })),
        subtotal: snapshot.subtotal,
        total: snapshot.total,
        itemCount: snapshot.itemCount,
        currency: snapshot.currency,
        checkoutUrl,
      }
    : undefined

  return {
    result: [
      `Order ${orderGroup} created for ${total.toFixed(2)} ${currency}.`,
      `Call send_payment_info next to forward payment details to the gateway.`,
    ].join(' '),
    cartPreview,
    shippingAddress: formatShippingAddress(orderForm),
    customerProfile: formatCustomerProfile(orderForm),
    // ── In-memory CheckoutState for the widget Pay-Now orchestrator ──
    //
    // Everything send_payment_info + authorize_transaction need to run
    // WITHOUT re-reading the (memoization-poisoned) VBase state record in
    // the same HTTP request: transactionId + orderGroup (the open
    // transaction), cartMandateId (for authorize's mandatePatch), and —
    // critically — merchantName. We surface merchantName here because it is
    // otherwise only a local var + a VBase field; without it the injected
    // send path falls back to ctx.vtex.account.toUpperCase() and can
    // reintroduce the wrong-merchant symptom. The iframe/MCP path ignores
    // this field and keeps reading VBase across its separate requests.
    checkoutState: {
      transactionId,
      orderGroup,
      merchantName,
      cartMandateId,
    },
    mandate: {
      mandateId: cartMandateId,
      retrievalUrl,
      cartHash: cartHash ?? '',
      signedBy: signedBy ?? `did:web:${host}`,
      signedAt: ap2.signedAt ?? new Date().toISOString(),
      didDocumentUrl,
      checkoutUrl,
      total,
      currency,
      orderGroup,
      transactionId,
      paymentMandateUrl,
      paymentReceiptUrl,
      verificationChecks,
      paymentApprovalStatus,
    },
  }
}

export const placeOrderTool: AgentTool = { definition, execute }
