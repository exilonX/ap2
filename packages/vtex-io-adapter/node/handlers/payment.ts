/**
 * Payment handler — POST /_v/acg/payment/execute
 *
 * Executes the AP2 payment ceremony: re-verify the signed CartMandate
 * against the current cart (drift detection), then mock-place the order.
 *
 * This is the REST face of the chat-side `execute_payment` AgentTool —
 * exposed for the MCP server (Claude Desktop iframe payment widget) so
 * it can drive the same ceremony from a non-chat surface. Issue 04
 * (post-demo, shared catalogue) reconciles the duplication.
 *
 * Request body: { mandateId: string }
 * Response: { success: true,  orderId, mandateId, signedBy }
 *        OR { success: false, reason, drifted, mandateId }
 *
 * The `success: false` path returns HTTP 200 (the request was processed
 * correctly — the cart just drifted). The caller surfaces the rejection
 * narratively. HTTP 4xx is reserved for malformed requests (missing
 * mandateId, no orderForm).
 */

import { json } from 'co-body'

import { Cart } from '../cart/cart'
import { OrderFormSubstitutedError } from '../cart/errors'
import { MandateOrchestration } from '../mandates/mandate-orchestration'
import { PaymentOrchestration } from '../payments/payment-orchestration'
import { VBaseKeyStore } from '../identity/vbase-keystore'
import {
  MockCredentialsProvider,
  MockPaymentNetwork,
} from '../mock-payment-network'
import { getOrderFormIdFromRequest } from '../utils/session'
import { buildMerchantIdentity } from './did'
import type { PaymentMandate, PaymentReceipt } from '../core'

const MOCK_CP_BUCKET = 'acg-mock-cp'
const MOCK_CP_KEY = 'cp-did'
const MOCK_NETWORK_BUCKET = 'acg-mock-network'
const MOCK_NETWORK_KEY = 'network-did'

/**
 * Mock CP and Network DID domains. They sit under the same Adapter
 * host as the merchant (so the DID documents resolve via the new
 * /_v/acg/mock-{cp,network}/.well-known/did.json routes), but with
 * distinct path prefixes so each party has its own DID.
 */
function buildMockDIDDomains(
  ctx: Context
): { cpDomain: string; networkDomain: string } {
  const workspace = ctx.vtex.workspace || 'master'
  const host =
    workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`

  return {
    cpDomain: `${host}:mock-cp`,
    networkDomain: `${host}:mock-network`,
  }
}

interface ExecutePaymentRequest {
  mandateId?: string
  /**
   * Demo-only — force the payment network to reject by failing one
   * specific check. The flag is silently dropped on master workspace
   * so production checkouts can never trigger this. Used by the iframe's
   * "force reject" link to record the rejection branch of the ceremony.
   */
  forceReject?: boolean
}

interface ExecutePaymentSuccess {
  success: true
  orderId: string
  mandateId: string
  signedBy: string
  cartTotal: number
  cartCurrency: string
  paymentMandate: PaymentMandate
  paymentReceipt: PaymentReceipt
  paymentMandateId: string
  paymentReceiptId: string
  paymentMandateUrl: string
  paymentReceiptUrl: string
  mockCpDid: string
  mockNetworkDid: string
}

interface ExecutePaymentFailure {
  success: false
  reason: string
  drifted: boolean
  mandateId: string | null
  /** Present when the chain reached the network and was rejected there. */
  paymentReceipt?: PaymentReceipt
  paymentReceiptId?: string
  paymentReceiptUrl?: string
}

export async function executePayment(ctx: Context): Promise<void> {
  let body: ExecutePaymentRequest

  try {
    body = (await json(ctx.req)) as ExecutePaymentRequest
  } catch {
    ctx.status = 400
    ctx.body = {
      success: false,
      reason: 'invalid request body',
      drifted: false,
      mandateId: null,
    }

    return
  }

  const { mandateId } = body

  if (!mandateId || typeof mandateId !== 'string') {
    ctx.status = 400
    ctx.body = {
      success: false,
      reason: 'missing mandateId — call /checkout/initiate first to sign one',
      drifted: false,
      mandateId: null,
    } as ExecutePaymentFailure

    return
  }

  const orderFormId = getOrderFormIdFromRequest(ctx)

  if (!orderFormId) {
    ctx.status = 400
    ctx.body = {
      success: false,
      reason: 'no active cart — add items and sign a mandate first',
      drifted: false,
      mandateId,
    } as ExecutePaymentFailure

    return
  }

  const cart = new Cart({ checkout: ctx.clients.checkout })
  let currentCart

  try {
    currentCart = await cart.getCart(orderFormId)
  } catch (err) {
    if (err instanceof OrderFormSubstitutedError) {
      ctx.status = 409
      ctx.body = {
        success: false,
        reason:
          'cart session was reset by VTEX — refresh and sign a new mandate',
        drifted: true,
        mandateId,
      } as ExecutePaymentFailure

      return
    }

    throw err
  }

  const identity = buildMerchantIdentity(ctx)
  const orchestration = new MandateOrchestration({
    identity,
    vbase: ctx.clients.vbase,
  })

  const verdict = await orchestration.verifyAgainstCart(mandateId, currentCart)

  if (!verdict.verification.valid) {
    ctx.status = 200
    ctx.body = {
      success: false,
      reason: verdict.reason ?? 'mandate verification failed',
      drifted: false,
      mandateId,
    } as ExecutePaymentFailure

    return
  }

  if (!verdict.cartMatches) {
    ctx.status = 200
    ctx.body = {
      success: false,
      reason: verdict.reason ?? 'cart drifted from the signed mandate',
      drifted: true,
      mandateId,
    } as ExecutePaymentFailure

    return
  }

  // ── PaymentMandate + PaymentReceipt ceremony (the AP2 punchline) ──
  //
  // verifyAgainstCart confirmed the cart hasn't drifted. Now we:
  //   1. Fetch the actual CartMandate (verdict only carries verification result)
  //   2. CP signs PaymentMandate
  //   3. Network verifies the chain + emits signed PaymentReceipt
  //   4. Persist both
  //   5. Return everything in the response so the iframe can render the
  //      multi-step animated reveal (Q10 from 2026-05-07 grilling).

  const bundle = await orchestration.retrieve(mandateId)

  if (!bundle) {
    ctx.status = 200
    ctx.body = {
      success: false,
      reason:
        'mandate verified but bundle missing on retrieve — should not happen',
      drifted: false,
      mandateId,
    } as ExecutePaymentFailure

    return
  }

  const { cpDomain, networkDomain } = buildMockDIDDomains(ctx)
  const cp = new MockCredentialsProvider({
    keyStore: new VBaseKeyStore(ctx.clients.vbase, MOCK_CP_BUCKET, MOCK_CP_KEY),
    domain: cpDomain,
  })

  const network = new MockPaymentNetwork({
    keyStore: new VBaseKeyStore(
      ctx.clients.vbase,
      MOCK_NETWORK_BUCKET,
      MOCK_NETWORK_KEY
    ),
    domain: networkDomain,
  })

  const payments = new PaymentOrchestration({
    identity,
    cp,
    network,
    vbase: ctx.clients.vbase,
  })

  // Honor `forceReject` only outside the master (production) workspace.
  // The iframe surfaces a small "(force reject — staging only)" link
  // so the demo recording can capture the rejection branch without
  // waiting 5 minutes for natural mandate expiry.
  const isProd = (ctx.vtex.workspace || 'master') === 'master'
  const forceFailCheck =
    body.forceReject && !isProd
      ? ('payment_mandate_not_expired' as const)
      : undefined

  const { paymentMandate, paymentReceipt } = await payments.signAndSubmit({
    cartMandate: bundle.cartMandate,
    // Per Q11 — hardcoded for v1 (interactive flows only). Autonomous
    // agent flows require IntentMandate; tracked in AP2_COMPLIANCE.md.
    agentPresence: { agent_involved: true, human_present: true },
    forceFailCheck,
  })

  const baseUrl = await resolveAdapterBaseUrl(ctx)
  const paymentMandateId =
    paymentMandate.payment_mandate_contents.payment_mandate_id

  const paymentReceiptId = paymentReceipt.contents.receipt_id

  // The network may have rejected the chain even though our local drift
  // check passed (e.g. a check we don't replicate locally — like
  // payment_mandate_not_expired immediately, or hash binding tampering
  // injected between our sign and the network call). Surface the
  // rejection with the signed receipt; the iframe still renders the
  // 7-check checklist with the failing dimensions.
  if (paymentReceipt.contents.approval_status === 'rejected') {
    ctx.status = 200
    ctx.body = {
      success: false,
      reason:
        paymentReceipt.contents.rejection_reason ??
        'payment network rejected the chain',
      drifted: false,
      mandateId,
      paymentReceipt,
      paymentReceiptId,
      paymentReceiptUrl: `${baseUrl}/_v/acg/receipts/${paymentReceiptId}`,
    } as ExecutePaymentFailure

    return
  }

  const orderId = `ACG-${Date.now()}`

  ctx.status = 200
  ctx.body = {
    success: true,
    orderId,
    mandateId,
    signedBy: await identity.getDID(),
    cartTotal: currentCart.total,
    cartCurrency: currentCart.currency,
    paymentMandate,
    paymentReceipt,
    paymentMandateId,
    paymentReceiptId,
    paymentMandateUrl: `${baseUrl}/_v/acg/payment-mandates/${paymentMandateId}`,
    paymentReceiptUrl: `${baseUrl}/_v/acg/receipts/${paymentReceiptId}`,
    mockCpDid: await cp.getDID(),
    mockNetworkDid: await network.getDID(),
  } as ExecutePaymentSuccess
}

/**
 * Compose the public host URL the iframe will use to retrieve mandates
 * and receipts. Mirrors the pattern in `chat.ts` / `checkout.ts`.
 */
async function resolveAdapterBaseUrl(ctx: Context): Promise<string> {
  const workspace = ctx.vtex.workspace || 'master'
  const host =
    workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`

  return `https://${host}`
}
