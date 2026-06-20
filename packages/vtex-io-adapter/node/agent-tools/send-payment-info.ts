/* eslint-disable no-console -- demo-quality stdout instrumentation; tracked by issue 0005 */
/**
 * send_payment_info — forward payment details to VTEX's payment gateway.
 *
 * Step 7 in the VTEX headless checkout flow. After place_order created
 * the transaction, this call posts the payment details (system, amount,
 * installments, currency) to `vtexpayments.com.br`. For non-card methods
 * (Cash, promissory, full-redirect) the `fields` payload is empty by
 * design — the gateway just needs to know which system to route to.
 *
 * The transactionId and orderGroup are read from the per-orderForm
 * VBase state record where place_order wrote them.
 */

import { readOrderFormState } from '../mandates/mandate-orchestration'
import type { Ap2CustomData } from '../mandates/mandate-orchestration'
import type { PaymentRequest } from '../clients/checkout'
import type { AgentTool, CheckoutState, ToolContext, ToolEffect } from './types'

const TAG = '[ACG send_payment_info]'

/**
 * Pull the injected CheckoutState off the private `ctx.injectedCheckoutState`
 * channel. The widget Pay-Now orchestrator (handlers/chat.ts) sets this so
 * we can skip the VBase read that the shared in-request HttpClient
 * memoization cache serves stale. Returns it only when COMPLETE
 * (transactionId + orderGroup both present); a partial/absent value falls
 * back to the unchanged VBase path used by the iframe/MCP surface.
 */
function readInjectedCheckoutState(
  ctx: ToolContext
): CheckoutState | undefined {
  const injected = ctx.injectedCheckoutState

  if (injected && injected.transactionId && injected.orderGroup) {
    return injected
  }

  return undefined
}

const definition = {
  name: 'send_payment_info',
  description:
    'Forward payment details to the VTEX payment gateway for the open transaction. Call after place_order. For non-card methods (Cash, redirects) no extra customer input is needed.',
  parameters: { type: 'object' as const, properties: {} },
}

async function execute(
  _args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolEffect> {
  console.log(`${TAG} start: orderFormId=${ctx.orderFormId ?? '<none>'}`)

  if (!ctx.orderFormId) {
    console.log(`${TAG} EXIT: no orderFormId`)

    return { result: 'ERROR: no active cart.' }
  }

  console.log(`${TAG} → GET /api/checkout/pub/orderForm/${ctx.orderFormId}`)
  const orderForm = await ctx.clients.checkout.getOrderForm(ctx.orderFormId)

  console.log(
    `${TAG} ← orderForm: items=${orderForm.items.length} value=${
      orderForm.value
    } payments.length=${orderForm.paymentData?.payments?.length ?? 0}`
  )

  if (orderForm.orderFormId !== ctx.orderFormId) {
    console.log(`${TAG} EXIT: orderFormId mismatch`)

    return {
      result:
        'ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.',
    }
  }

  // ── Resolve transaction state — injected (widget Pay-Now) vs VBase. ──
  //
  // The widget orchestrator threads the just-placed transaction in memory
  // via `ctx.injectedCheckoutState` so we never re-read the VBase state
  // record (which the shared in-request HttpClient memoization cache serves
  // stale). When that injected state is present and complete, it is
  // AUTHORITATIVE — we skip readOrderFormState entirely. The iframe/MCP path
  // sets no such field and keeps the unchanged VBase read below. It lives on
  // ToolContext (not `args`) so the LLM can never supply it.
  const injected = readInjectedCheckoutState(ctx)
  let ap2: Ap2CustomData

  if (injected) {
    console.log(
      `${TAG} using injected CheckoutState (skip VBase read): transactionId=${injected.transactionId} orderGroup=${injected.orderGroup} merchantName=${injected.merchantName}`
    )
    ap2 = {
      transactionId: injected.transactionId,
      orderGroup: injected.orderGroup,
      merchantName: injected.merchantName,
      cartMandateId: injected.cartMandateId,
    }
  } else {
    console.log(`${TAG} → vbase.read acg-orderform-state/${ctx.orderFormId}`)
    ap2 = await readOrderFormState(ctx.clients.vbase, ctx.orderFormId)

    console.log(`${TAG} ← orderForm state = ${JSON.stringify(ap2)}`)

    if (!ap2.transactionId || !ap2.orderGroup) {
      console.log(
        `${TAG} EXIT: no open transaction (transactionId=${
          ap2.transactionId ?? '<none>'
        } orderGroup=${ap2.orderGroup ?? '<none>'})`
      )

      return {
        result:
          'ERROR: no open transaction on this cart. Call place_order before send_payment_info.',
      }
    }
  }

  // Narrow to non-null strings. Both branches above guarantee these are set
  // (injected state is validated complete; the VBase branch early-returns
  // otherwise), but the type is still optional, so re-assert.
  const { transactionId, orderGroup } = ap2

  if (!transactionId || !orderGroup) {
    return {
      result:
        'ERROR: no open transaction on this cart. Call place_order before send_payment_info.',
    }
  }

  const payments = orderForm.paymentData?.payments as
    | Array<Record<string, unknown>>
    | undefined

  if (!payments || payments.length === 0) {
    console.log(`${TAG} EXIT: paymentData was cleared`)

    return {
      result:
        'ERROR: paymentData was reset between place_order and send_payment_info. Call set_payment_method and place_order again.',
    }
  }

  // merchantName: prefer the value VTEX echoed back at placeOrder time
  // (surfaced in the injected CheckoutState, or saved in VBase state). Fall
  // back to ctx.vtex.account.toUpperCase() only if place_order didn't
  // capture it (legacy carts). On the injected path the merchantName is
  // always carried, so a fallback there signals a bug worth logging — it is
  // the exact symptom (wrong merchant) the injected channel exists to fix.
  if (injected && !ap2.merchantName) {
    console.warn(
      `${TAG} ⚠ injected CheckoutState missing merchantName — falling back to ctx.vtex.account; this can reintroduce the wrong-merchant symptom`
    )
  }

  const merchantName = ap2.merchantName ?? ctx.vtex.account.toUpperCase()
  const { currencyCode } = orderForm.storePreferencesData

  // Per the VTEX payments gateway:
  //   - paymentSystem MUST be a STRING (matches the orderForm echo;
  //     sending a number triggers a silent NRE on VTEX's side)
  //   - `fields` stays empty for Cash/promissory/redirect; only direct
  //     card capture populates it with cardNumber/csc/expirationDate/
  //     holderName (which means CARDHOLDER, not buyer identity).
  //     Buyer-identity badges on the PCI Gateway transaction widget
  //     come from addPaymentData.payments[].firstName/lastName/document/
  //     documentType — set in Cart.setPaymentData, NOT here.
  //   - the array is sent as a BARE ARRAY in the request body (the
  //     CheckoutClient.sendPayments method handles that, but the array
  //     elements MUST match this exact shape)
  const requests: PaymentRequest[] = payments.map((p) => ({
    paymentSystem: String(p.paymentSystem),
    installments: Number(p.installments ?? 1),
    installmentsInterestRate: Number(p.installmentsInterestRate ?? 0),
    installmentsValue: Number(p.value),
    value: Number(p.value),
    referenceValue: Number(p.referenceValue ?? p.value),
    fields: {},
    transaction: { id: transactionId, merchantName },
    currencyCode,
  }))

  console.log(
    `${TAG} → POST {account}.vtexpayments.com.br/api/pub/transactions/${transactionId}/payments?orderId=${orderGroup} — ${
      requests.length
    } request(s) systems=[${requests
      .map((r) => r.paymentSystem)
      .join(',')}] currency=${currencyCode} merchantName=${merchantName}`
  )

  const sentAt = Date.now()
  let response: unknown

  try {
    response = await ctx.clients.payments.sendPayments(
      transactionId,
      orderGroup,
      requests
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    console.log(
      `${TAG} ✗ sendPayments threw after ${Date.now() - sentAt}ms: ${msg}`
    )
    throw err
  }

  console.log(
    `${TAG} ← sendPayments ${Date.now() - sentAt}ms response=${
      typeof response === 'object' && response !== null
        ? JSON.stringify(response).slice(0, 300)
        : String(response)
    }`
  )
  console.log(`${TAG} ✓ done`)

  return {
    result: `Payment information sent to gateway for transaction ${transactionId}. Call authorize_transaction next to finalize.`,
  }
}

export const sendPaymentInfoTool: AgentTool = { definition, execute }
