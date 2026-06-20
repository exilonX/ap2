/**
 * authorize_transaction — finalize the open transaction.
 *
 * VTEX's official 3-step flow ends with `gatewayCallback`. BUT in IO/
 * server-to-server context that endpoint needs the storefront session
 * cookies the BFF skill carries on a browser session (CHK003 "acces
 * interzis" otherwise). Our authoritative path is therefore the
 * Payments Gateway `/pvt/authorization-request` with AppKey/AppToken —
 * which returns the actual gateway status (numeric for Cash/promissory).
 *
 * Order of operations:
 *   1. POST /api/pvt/transactions/:tid/authorization-request  ← primary
 *   2. POST /api/checkout/pub/gatewayCallback/:orderGroup     ← fallback
 *
 * The agent-facing return reports approved/pending in plain English.
 *
 * Numeric status code reference (observed from live Cash payments):
 *   1, 2  → approved variants
 *   8     → approved + awaiting automatic settlement (Cash)
 *   3, 4  → denied / cancelled
 *   anything else → pass through as "status N"
 *
 * transactionId and orderGroup come from the per-orderForm VBase state
 * record where place_order wrote them.
 */

/* eslint-disable no-console -- demo-quality stdout instrumentation; tracked by issue 0005 */
import { readOrderFormState } from '../mandates/mandate-orchestration'
import type { Ap2CustomData } from '../mandates/mandate-orchestration'
import type {
  AgentTool,
  CheckoutState,
  MandateInfo,
  ToolContext,
  ToolEffect,
} from './types'

const TAG = '[ACG authorize_transaction]'

/**
 * Pull the injected CheckoutState off the private `ctx.injectedCheckoutState`
 * channel (set by the widget Pay-Now orchestrator, NOT the LLM-populated args
 * bag). Returns it only when COMPLETE (transactionId + orderGroup present) so
 * the orchestrator path can skip the memoization-poisoned VBase read;
 * absent/partial falls back to the unchanged VBase path used by the iframe/MCP
 * surface.
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
  name: 'authorize_transaction',
  description:
    "Finalize the open transaction (step 3 of VTEX's 3-step flow: place_order → send_payment_info → authorize_transaction). Requests authorization from the Payments Gateway; falls back to gatewayCallback if the merchant didn't configure AppKey/AppToken. For Cash/promissory the result is 'approved, awaiting settlement'; for card/redirect methods the gateway handles the customer flow.",
  parameters: { type: 'object' as const, properties: {} },
}

interface ParsedVtexError {
  httpStatus: number
  vtexErrorCode: string
  vtexErrorMessage: string
  rawMessage: string
}

function parseVtexError(err: unknown): ParsedVtexError {
  const response = (err as {
    response?: {
      status?: number
      data?: { error?: { code?: string | number; message?: string } }
      headers?: Record<string, string | undefined>
    }
  })?.response

  return {
    httpStatus: response?.status ?? 0,
    vtexErrorCode: String(
      response?.data?.error?.code ??
        response?.headers?.['x-vtex-error-code'] ??
        ''
    ),
    vtexErrorMessage: String(
      response?.data?.error?.message ?? ''
    ).toLowerCase(),
    rawMessage: err instanceof Error ? err.message : String(err),
  }
}

/**
 * Map the gateway's status field (string OR numeric) to an
 * agent-friendly category. Cash/promissory typically returns 8
 * ("approved, awaiting automatic settlement"), while card direct
 * returns the string enum.
 */
function categorizeAuthStatus(
  status: string | number | undefined
): 'approved' | 'pending' | 'denied' | 'unknown' {
  if (status === undefined || status === null) return 'unknown'

  if (typeof status === 'string') {
    const s = status.toLowerCase()

    if (s === 'approved' || s === 'completed' || s === 'success') {
      return 'approved'
    }

    if (s === 'denied' || s === 'cancelled' || s === 'canceled') return 'denied'
    if (s === 'pending' || s === 'undefined' || s === 'authorize') {
      return 'pending'
    }

    return 'unknown'
  }

  // Numeric VTEX payment status codes (observed in live cash/promissory
  // flows). 1/2/8 are the approved variants we've seen, 3/4 the denied
  // ones. The screenshot "APROBATĂ + Decontare automată programată"
  // corresponds to status=8.
  if (status === 1 || status === 2 || status === 8) return 'approved'
  if (status === 3 || status === 4) return 'denied'
  if (status === 0 || status === 5 || status === 6 || status === 7) {
    return 'pending'
  }

  return 'unknown'
}

/**
 * Build the partial mandate update authorize_transaction returns. The
 * chat handler merges it into the mandate already populated by
 * place_order, so we only carry the fields this tool knows about
 * (cartMandateId from VBase state + gatewayStatus + orderGroup/tid).
 */
function buildMandatePatch(
  ap2: Ap2CustomData,
  gatewayStatus: 'approved' | 'pending' | 'denied' | undefined
): (Partial<MandateInfo> & { mandateId: string }) | undefined {
  if (!ap2.cartMandateId) return undefined

  return {
    mandateId: ap2.cartMandateId,
    orderGroup: ap2.orderGroup,
    transactionId: ap2.transactionId,
    ...(gatewayStatus ? { gatewayStatus } : {}),
  }
}

async function tryPaymentsAuthorize(
  ctx: ToolContext,
  transactionId: string,
  orderGroup: string
): Promise<
  | { ok: true; status: string | number; orderId: string; raw: unknown }
  | { ok: false; err: unknown }
> {
  const settings = await ctx.clients.apps
    .getAppSettings('vtexeurope.acg-adapter')
    .catch(() => ({} as { vtexAppKey?: string; vtexAppToken?: string }))

  const credentials =
    settings.vtexAppKey && settings.vtexAppToken
      ? { appKey: settings.vtexAppKey, appToken: settings.vtexAppToken }
      : undefined

  console.log(
    `${TAG} → POST {account}.vtexpayments.com.br/api/pvt/transactions/${transactionId}/authorization-request { orderId=${orderGroup}, credentials=${
      credentials ? '<present>' : '<not configured>'
    } }`
  )

  const startedAt = Date.now()

  try {
    const auth = await ctx.clients.payments.authorizeTransaction(
      transactionId,
      orderGroup,
      credentials ? { credentials } : undefined
    )

    console.log(
      `${TAG} ← authorize ${Date.now() - startedAt}ms: raw=${JSON.stringify(
        auth
      ).slice(0, 300)}`
    )

    return {
      ok: true,
      status: (auth?.status as string | number) ?? 'unknown',
      orderId: auth?.orderId ?? orderGroup,
      raw: auth,
    }
  } catch (err) {
    return { ok: false, err }
  }
}

async function tryGatewayCallback(
  ctx: ToolContext,
  orderGroup: string
): Promise<{ ok: true } | { ok: false; err: unknown }> {
  console.log(
    `${TAG} → POST /api/checkout/pub/gatewayCallback/${orderGroup} (process order)`
  )
  const startedAt = Date.now()

  try {
    await ctx.clients.checkout.processOrder(orderGroup)
    console.log(
      `${TAG} ← processOrder ${Date.now() - startedAt}ms: 204 (finalized)`
    )

    return { ok: true }
  } catch (err) {
    const parsed = parseVtexError(err)

    console.log(
      `${TAG} ✗ processOrder threw after ${Date.now() - startedAt}ms: ${
        parsed.rawMessage
      } httpStatus=${parsed.httpStatus} vtexCode=${
        parsed.vtexErrorCode || '<none>'
      } vtexMsg="${parsed.vtexErrorMessage}"`
    )

    return { ok: false, err }
  }
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

  // ── Resolve transaction state — injected (widget Pay-Now) vs VBase. ──
  //
  // Mirrors send_payment_info: when the widget orchestrator threads the
  // CheckoutState in memory we treat it as authoritative and skip the VBase
  // read (which the shared in-request HttpClient memoization cache serves
  // stale). buildMandatePatch below reads cartMandateId from this same
  // state. The iframe/MCP path sets no field and keeps the VBase read.
  const injected = readInjectedCheckoutState(ctx)
  let ap2: Ap2CustomData

  if (injected) {
    console.log(
      `${TAG} using injected CheckoutState (skip VBase read): transactionId=${
        injected.transactionId
      } orderGroup=${injected.orderGroup} cartMandateId=${
        injected.cartMandateId ?? '<none>'
      }`
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
          'ERROR: no open transaction on this cart. Call place_order and send_payment_info before authorize_transaction.',
      }
    }
  }

  // Narrow to non-null strings. Both branches above guarantee these are
  // set (injected state is validated complete; the VBase branch early-
  // returns otherwise), but the type is still optional, so re-assert.
  const { transactionId, orderGroup } = ap2

  if (!transactionId || !orderGroup) {
    return {
      result:
        'ERROR: no open transaction on this cart. Call place_order and send_payment_info before authorize_transaction.',
    }
  }

  // Primary: /pvt/ authorization-request (works in IO with AppKey/Token).
  const primary = await tryPaymentsAuthorize(ctx, transactionId, orderGroup)

  if (primary.ok) {
    const category = categorizeAuthStatus(primary.status)

    console.log(
      `${TAG} ✓ /pvt/ authorize: status=${primary.status} → ${category}`
    )

    if (category === 'approved') {
      return {
        result: [
          `Order ${primary.orderId} approved (gateway status ${primary.status}).`,
          `For Cash/promissory the order moves to "payment-pending" and is settled when the merchant marks it as paid.`,
          `The AP2 mandate chain is the cryptographic proof of this purchase.`,
        ].join(' '),
        mandatePatch: buildMandatePatch(ap2, 'approved'),
      }
    }

    if (category === 'pending') {
      return {
        result: [
          `Order ${primary.orderId} awaiting payment confirmation (gateway status ${primary.status}).`,
          `For card or redirect methods the customer completes payment with the provider — VTEX will finalize asynchronously.`,
        ].join(' '),
        mandatePatch: buildMandatePatch(ap2, 'pending'),
      }
    }

    if (category === 'denied') {
      return {
        result: `Order ${primary.orderId} was denied by the payment gateway (status ${primary.status}).`,
        mandatePatch: buildMandatePatch(ap2, 'denied'),
      }
    }

    return {
      result: `Authorization returned status ${primary.status} for order ${primary.orderId}.`,
      mandatePatch: buildMandatePatch(ap2, undefined),
    }
  }

  // Primary failed — inspect why.
  const primaryParsed = parseVtexError(primary.err)
  const isPending =
    primaryParsed.vtexErrorCode === '1403' ||
    primaryParsed.vtexErrorMessage.includes('authorization is pending') ||
    primaryParsed.vtexErrorMessage.includes(
      'new authorization execution is needed'
    )

  const isUnauthorized = primaryParsed.httpStatus === 401

  console.log(
    `${TAG} ↳ /pvt/ authorize failed: httpStatus=${
      primaryParsed.httpStatus
    } vtexCode=${
      primaryParsed.vtexErrorCode || '<none>'
    } isPending=${isPending} isUnauthorized=${isUnauthorized}`
  )

  if (isPending) {
    console.log(
      `${TAG} ↳ 1403 "already authorizing" — gateway has the payment, settling asynchronously.`
    )

    return {
      result: [
        `Order ${ap2.orderGroup} accepted by the gateway (already authorizing).`,
        `Cash/promissory payments finalize when the merchant marks them as paid.`,
      ].join(' '),
      mandatePatch: buildMandatePatch(ap2, 'approved'),
    }
  }

  // Fallback: gatewayCallback. May 500/CHK003 in IO context (no session
  // cookies) but for Cash the gateway often auto-finalizes anyway, so the
  // order in admin will be APROBATĂ regardless.
  console.log(`${TAG} ↳ falling back to gatewayCallback`)
  const fallback = await tryGatewayCallback(ctx, orderGroup)

  if (fallback.ok) {
    return {
      result: [
        `Order ${ap2.orderGroup} finalized via gatewayCallback.`,
        `The AP2 mandate chain is the cryptographic proof of this purchase.`,
      ].join(' '),
      mandatePatch: buildMandatePatch(ap2, 'approved'),
    }
  }

  // Both paths failed. For Cash the order may STILL be approved in admin
  // (we've seen this: status=8 returned but processOrder failed with
  // CHK003, order ended up APROBATĂ regardless). Surface the orderGroup
  // and let the merchant verify rather than report a hard failure.
  if (isUnauthorized) {
    return {
      result: [
        `Order ${ap2.orderGroup} created in OMS — VTEX rejected the explicit authorization request (no Payments Gateway credentials configured).`,
        `Cash/promissory orders typically auto-approve; verify status in admin.`,
      ].join(' '),
      mandatePatch: buildMandatePatch(ap2, 'pending'),
    }
  }

  return {
    result: [
      `Order ${ap2.orderGroup} created in OMS but final authorization status is unclear.`,
      `Verify the order state in admin → orders.`,
    ].join(' '),
    mandatePatch: buildMandatePatch(ap2, undefined),
  }
}

export const authorizeTransactionTool: AgentTool = { definition, execute }
