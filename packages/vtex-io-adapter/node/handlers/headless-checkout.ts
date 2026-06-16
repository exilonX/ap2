/**
 * Headless Checkout Handlers — REST face of the five new AgentTools.
 *
 * Each handler is a thin wrapper that builds a ToolContext from the
 * request and invokes the matching AgentTool's `execute`. The response
 * body is the full ToolEffect so MCP-side and widget-side callers see
 * the same shape they would when the chat handler dispatches the same
 * tool.
 *
 * Used by:
 *   - MCP server proxy tools (Claude Desktop, Claude Code)
 *   - Any external caller that wants to drive the headless flow
 *     step-by-step without going through the chat surface.
 */

import { json } from 'co-body'

import { authorizeTransactionTool } from '../agent-tools/authorize-transaction'
import { createCartMandateTool } from '../agent-tools/create-cart-mandate'
import { listPaymentMethodsTool } from '../agent-tools/list-payment-methods'
import { placeOrderTool } from '../agent-tools/place-order'
import { sendPaymentInfoTool } from '../agent-tools/send-payment-info'
import { setPaymentMethodTool } from '../agent-tools/set-payment-method'
import type { AgentTool, ToolContext } from '../agent-tools/types'
import { loadConfigForAccount } from '../config/load'
import { getOrderFormIdFromRequest } from '../utils/session'

async function runTool(
  ctx: Context,
  tool: AgentTool,
  args: Record<string, unknown>
): Promise<void> {
  const orderFormId = getOrderFormIdFromRequest(ctx)
  const config = loadConfigForAccount(ctx.vtex.account || '')
  const toolCtx: ToolContext = {
    vtex: ctx.vtex,
    clients: ctx.clients,
    config,
    orderFormId,
  }

  try {
    const effect = await tool.execute(args, toolCtx)

    ctx.status = 200
    ctx.body = effect
  } catch (err) {
    console.error(`[ACG Headless] ${tool.definition.name} failed:`, err)
    ctx.status = 500
    ctx.body = {
      success: false,
      error: `${tool.definition.name} failed`,
      message: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

async function readBody(ctx: Context): Promise<Record<string, unknown>> {
  try {
    const body = await json(ctx.req)

    return (body as Record<string, unknown>) ?? {}
  } catch {
    return {}
  }
}

/**
 * POST /_v/acg/checkout/create-mandate
 *
 * Entry-point for the headless flow. Signs the AP2 CartMandate against
 * the current cart, persists the bundle to VBase, AND writes the mandate
 * id into `orderForm.customData.ap2` so the subsequent tools (place-order,
 * send-payment-info, authorize) can rediscover it.
 *
 * This is the gating call: without it, place-order returns
 * "no signed CartMandate" and the chain stops.
 */
export async function createMandateHandler(ctx: Context): Promise<void> {
  await runTool(ctx, createCartMandateTool, {})
}

/**
 * POST /_v/acg/checkout/list-payment-methods
 */
export async function listPaymentMethodsHandler(ctx: Context): Promise<void> {
  await runTool(ctx, listPaymentMethodsTool, {})
}

/**
 * POST /_v/acg/checkout/set-payment-method
 * Body: { paymentSystemId: string, installments?: number }
 */
export async function setPaymentMethodHandler(ctx: Context): Promise<void> {
  const body = await readBody(ctx)

  await runTool(ctx, setPaymentMethodTool, body)
}

/**
 * POST /_v/acg/checkout/place-order
 */
export async function placeOrderHandler(ctx: Context): Promise<void> {
  await runTool(ctx, placeOrderTool, {})
}

/**
 * POST /_v/acg/checkout/send-payment-info
 */
export async function sendPaymentInfoHandler(ctx: Context): Promise<void> {
  await runTool(ctx, sendPaymentInfoTool, {})
}

/**
 * POST /_v/acg/checkout/authorize
 */
export async function authorizeTransactionHandler(ctx: Context): Promise<void> {
  await runTool(ctx, authorizeTransactionTool, {})
}
