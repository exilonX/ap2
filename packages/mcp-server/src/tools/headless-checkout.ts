/**
 * Headless Checkout MCP Tools — the ONLY way to create a real VTEX
 * order from Claude Desktop / Claude Code via this MCP server.
 *
 * Five tools, one happy path:
 *
 *   1. listPaymentMethods    — surface the merchant's configured methods
 *   2. setPaymentMethod      — record the choice on the cart
 *   3. placeOrder            — sign the AP2 CartMandate AND create the
 *                              VTEX transaction (single call, no separate
 *                              `createCartMandate` step)
 *   4. sendPaymentInfo       — forward payment details to the gateway
 *   5. authorizeTransaction  — finalize the transaction
 *
 * Each tool proxies to a matching `/_v/acg/checkout/*` route on the
 * adapter. The adapter's response carries the same `result` string the
 * chat surface would show, so Claude renders it consistently across
 * surfaces.
 *
 * The legacy mock tools (`checkoutInChat`, `executePayment`, `checkout`)
 * are no longer registered. If you need to verify an order after the
 * fact, use `checkOrderStatus` from `tools/checkout.ts`.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'

interface PaymentMethodItem {
  id: string
  name: string
  group?: string
}

interface ToolEffectResponse {
  result?: string
  suggestions?: string[]
  cartUpdated?: boolean
  paymentMethods?: PaymentMethodItem[]
  [k: string]: unknown
}

/**
 * Format a list-payment-methods response as a numbered list Claude can
 * render inline ("Reply with 1, 2, or 3 to pick"). The widget gets the
 * structured `paymentMethods` field for pill buttons; Claude Desktop
 * gets this human-readable text since there's no UI extension.
 */
function formatPaymentMethods(response: ToolEffectResponse): string {
  if (!response.paymentMethods || response.paymentMethods.length === 0) {
    return response.result ?? 'No payment methods returned.'
  }

  const numbered = response.paymentMethods
    .map((m, i) => `  ${i + 1}. ${m.name} (id: ${m.id})`)
    .join('\n')

  return [
    `Available payment methods:`,
    numbered,
    ``,
    `Reply with the number or method name; I'll call setPaymentMethod with the id, then placeOrder → sendPaymentInfo → authorizeTransaction to finalize.`,
  ].join('\n')
}

export function registerHeadlessCheckoutTools(
  server: McpServer,
  client: VtexClient
) {
  // ─── listPaymentMethods ──────────────────────────────────────────
  server.tool(
    'listPaymentMethods',
    'List the payment methods the merchant has configured for the current cart. Call this once the cart is otherwise ready (items + profile + shipping) so the customer can pick from real merchant options. Step 1 of the headless checkout flow.',
    {},
    async () => {
      try {
        const result = await client.post<ToolEffectResponse>(
          '/checkout/list-payment-methods'
        )
        // Claude Desktop renders Markdown — surface a numbered list so the
        // user can reply "1" / "Cash" / etc. without re-reading JSON.
        return {
          content: [
            { type: 'text' as const, text: formatPaymentMethods(result) },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ─── setPaymentMethod ────────────────────────────────────────────
  server.tool(
    'setPaymentMethod',
    {
      paymentSystemId: z
        .string()
        .describe(
          'Payment system id from listPaymentMethods (e.g. "47" for Cash).'
        ),
      installments: z
        .number()
        .optional()
        .describe('Number of installments. Defaults to 1.'),
    },
    async (params) => {
      try {
        const result = await client.post<ToolEffectResponse>(
          '/checkout/set-payment-method',
          params
        )
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ─── placeOrder ──────────────────────────────────────────────────
  //
  // The entry point. Signs the AP2 CartMandate over the current cart
  // (auto-mandate path) AND creates a real VTEX transaction in a single
  // call. No separate createCartMandate step.
  server.tool(
    'placeOrder',
    'Create a real VTEX order. This single call signs the AP2 CartMandate over the current cart AND posts the transaction to VTEX OMS. Requires the cart to have items, customer profile, shipping address, and a selected payment method (use setPaymentMethod first). After this returns successfully, call sendPaymentInfo then authorizeTransaction to finalize. This is the ONLY way to create a real order via this MCP server — there is no fallback iframe / mock tool.',
    {},
    async () => {
      try {
        const result = await client.post<ToolEffectResponse>(
          '/checkout/place-order'
        )
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ─── sendPaymentInfo ─────────────────────────────────────────────
  server.tool(
    'sendPaymentInfo',
    'Forward payment details to the VTEX payment gateway for the open transaction. Call after placeOrder.',
    {},
    async () => {
      try {
        const result = await client.post<ToolEffectResponse>(
          '/checkout/send-payment-info'
        )
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ─── authorizeTransaction ────────────────────────────────────────
  server.tool(
    'authorizeTransaction',
    'Authorize the open transaction with the gateway. Returns the final order status. For Cash / promissory the status is immediate; for card / redirect methods the customer continues with the provider and VTEX finalizes asynchronously.',
    {},
    async () => {
      try {
        const result = await client.post<ToolEffectResponse>(
          '/checkout/authorize'
        )
        // The order is closed (approved or pending) — clear the cart
        // session so the next conversation starts fresh.
        client.clearOrderFormId()
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
            },
          ],
          isError: true,
        }
      }
    }
  )

  console.error('[ACG] Headless checkout tools registered (5 tools: list/setPaymentMethod, placeOrder [auto-mandate], sendPaymentInfo, authorizeTransaction)')
}
