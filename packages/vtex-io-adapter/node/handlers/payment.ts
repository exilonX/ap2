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

import { json } from 'co-body';

import { Cart } from '../cart/cart';
import { OrderFormSubstitutedError } from '../cart/errors';
import { MandateOrchestration } from '../mandates/mandate-orchestration';
import { getOrderFormIdFromRequest } from '../utils/session';
import { buildMerchantIdentity } from './did';

interface ExecutePaymentRequest {
  mandateId?: string;
}

interface ExecutePaymentSuccess {
  success: true;
  orderId: string;
  mandateId: string;
  signedBy: string;
  cartTotal: number;
  cartCurrency: string;
}

interface ExecutePaymentFailure {
  success: false;
  reason: string;
  drifted: boolean;
  mandateId: string | null;
}

export async function executePayment(ctx: Context): Promise<void> {
  let body: ExecutePaymentRequest;
  try {
    body = (await json(ctx.req)) as ExecutePaymentRequest;
  } catch {
    ctx.status = 400;
    ctx.body = { success: false, reason: 'invalid request body', drifted: false, mandateId: null };
    return;
  }

  const mandateId = body.mandateId;
  if (!mandateId || typeof mandateId !== 'string') {
    ctx.status = 400;
    ctx.body = {
      success: false,
      reason: 'missing mandateId — call /checkout/initiate first to sign one',
      drifted: false,
      mandateId: null,
    } as ExecutePaymentFailure;
    return;
  }

  const orderFormId = getOrderFormIdFromRequest(ctx);
  if (!orderFormId) {
    ctx.status = 400;
    ctx.body = {
      success: false,
      reason: 'no active cart — add items and sign a mandate first',
      drifted: false,
      mandateId,
    } as ExecutePaymentFailure;
    return;
  }

  const cart = new Cart({ checkout: ctx.clients.checkout });
  let currentCart;
  try {
    currentCart = await cart.getCart(orderFormId);
  } catch (err) {
    if (err instanceof OrderFormSubstitutedError) {
      ctx.status = 409;
      ctx.body = {
        success: false,
        reason: 'cart session was reset by VTEX — refresh and sign a new mandate',
        drifted: true,
        mandateId,
      } as ExecutePaymentFailure;
      return;
    }
    throw err;
  }

  const identity = buildMerchantIdentity(ctx);
  const orchestration = new MandateOrchestration({
    identity,
    vbase: ctx.clients.vbase,
  });

  const verdict = await orchestration.verifyAgainstCart(mandateId, currentCart);

  if (!verdict.verification.valid) {
    ctx.status = 200;
    ctx.body = {
      success: false,
      reason: verdict.reason ?? 'mandate verification failed',
      drifted: false,
      mandateId,
    } as ExecutePaymentFailure;
    return;
  }

  if (!verdict.cartMatches) {
    ctx.status = 200;
    ctx.body = {
      success: false,
      reason: verdict.reason ?? 'cart drifted from the signed mandate',
      drifted: true,
      mandateId,
    } as ExecutePaymentFailure;
    return;
  }

  const orderId = `ACG-${Date.now()}`;
  ctx.status = 200;
  ctx.body = {
    success: true,
    orderId,
    mandateId,
    signedBy: verdict.verification.checks.signatureValid
      ? await identity.getDID()
      : '',
    cartTotal: currentCart.total,
    cartCurrency: currentCart.currency,
  } as ExecutePaymentSuccess;
}
