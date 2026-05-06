/**
 * execute_payment — verify drift, mock-place order.
 *
 * The third of the three demo-recordable AP2 beats. The DEMO PUNCHLINE:
 * before any payment is finalized, re-verify the signed mandate against
 * the current cart. If anything drifted (item changes, total, currency,
 * orderForm substitution) — reject the payment and explain why.
 *
 * Stubbed past the verifyAgainstCart wiring (resolution Q8). No real
 * VTEX `placeOrder`, no PSP, no card capture. The cryptographic
 * ceremony beat is real; the order placement is mock.
 *
 * Issue 01 G provides the primitive (`MandateOrchestration.verifyAgainstCart`);
 * this tool wires it into the agent surface.
 */

import { Cart } from '../cart/cart';
import { OrderFormSubstitutedError } from '../cart/errors';
import { buildMerchantIdentity } from '../handlers/did';
import { MandateOrchestration } from '../mandates/mandate-orchestration';
import type { AgentTool, ToolContext, ToolEffect } from './types';

interface ExecutePaymentArgs {
  mandateId?: string;
}

const definition = {
  name: 'execute_payment',
  description:
    "Finalize payment for a previously-signed CartMandate. Verifies the cart hasn't drifted since signing — if any item, quantity, or total changed, payment is rejected and the customer must sign a new mandate. Required after create_cart_mandate.",
  parameters: {
    type: 'object' as const,
    properties: {
      mandateId: {
        type: 'string',
        description:
          'The mandate id returned by create_cart_mandate. Required.',
      },
    },
    required: ['mandateId'],
  },
};

async function execute(
  args: ExecutePaymentArgs,
  ctx: ToolContext
): Promise<ToolEffect> {
  const mandateId = args.mandateId;
  if (!mandateId || typeof mandateId !== 'string') {
    return {
      result:
        'ERROR: missing mandateId. Call create_cart_mandate first to get one, then pass its mandateId here.',
    };
  }

  if (!ctx.orderFormId) {
    return { result: 'ERROR: no active cart. Add items and sign a mandate first.' };
  }

  const cart = new Cart({ checkout: ctx.clients.checkout });
  let currentCart;
  try {
    currentCart = await cart.getCart(ctx.orderFormId);
  } catch (err) {
    if (err instanceof OrderFormSubstitutedError) {
      return {
        result:
          'ERROR: cart session was reset by VTEX. Ask the customer to refresh and sign a new mandate.',
      };
    }
    throw err;
  }

  const identity = buildMerchantIdentity(ctx as unknown as Context);
  const orchestration = new MandateOrchestration({
    identity,
    vbase: ctx.clients.vbase,
  });

  const verdict = await orchestration.verifyAgainstCart(mandateId, currentCart);

  if (!verdict.verification.valid) {
    return {
      result: `ERROR: mandate ${mandateId} did not verify (${verdict.reason ?? 'unknown reason'}). Sign a new mandate before paying.`,
    };
  }

  if (!verdict.cartMatches) {
    return {
      result: `Payment rejected. Cart drifted from the signed mandate: ${verdict.reason}. Ask the customer to confirm the new cart and sign a fresh mandate before paying.`,
    };
  }

  // Mock order placement (resolution Q8 — verify wired, payment stubbed).
  const orderId = `ACG-${Date.now()}`;
  return {
    result: [
      `Payment authorized. Order ${orderId} placed.`,
      `The merchant honored the signed mandate ${mandateId} — cart matched at pay time.`,
    ].join(' '),
  };
}

export const executePaymentTool: AgentTool = { definition, execute };
