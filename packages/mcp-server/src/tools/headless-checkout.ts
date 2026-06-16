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

import { readFileSync } from 'fs'
import { join } from 'path'

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'

interface PaymentMethodItem {
  id: string
  name: string
  group?: string
}

interface MandateItem {
  mandateId: string
  retrievalUrl?: string
  cartHash?: string
  signedBy?: string
  signedAt?: string
  didDocumentUrl?: string
  checkoutUrl?: string
  total?: number
  currency?: string
  orderGroup?: string
  transactionId?: string
  gatewayStatus?: 'approved' | 'pending' | 'denied'
}

interface CartPreviewItem {
  sku: string
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
  image?: string
}

interface CartPreviewData {
  items: CartPreviewItem[]
  subtotal: number
  total: number
  itemCount: number
  currency: string
  checkoutUrl: string
}

interface ToolEffectResponse {
  result?: string
  suggestions?: string[]
  cartUpdated?: boolean
  paymentMethods?: PaymentMethodItem[]
  cartPreview?: CartPreviewData
  mandate?: MandateItem
  selectedPayment?: PaymentMethodItem
  [k: string]: unknown
}

const CHECKOUT_APP_URI = 'ui://acg-checkout/index.html'

/**
 * Build the iframe consent payload from a setPaymentMethod response.
 * The iframe renders cart + selected payment method + active Pay Now
 * button. Mandate-related fields are empty — no signing happens until
 * the user clicks Pay Now, which calls placeOrder via JSON-RPC.
 */
function buildSetPaymentMethodIframePayload(
  response: ToolEffectResponse
): unknown {
  const cart = response.cartPreview
  if (!cart) return response

  const shipping = Math.max(0, (cart.total ?? 0) - (cart.subtotal ?? 0))

  return {
    cart: {
      items: cart.items,
      subtotal: cart.subtotal,
      shipping: shipping || undefined,
      total: cart.total,
      currency: cart.currency,
    },
    selectedPayment: response.selectedPayment ?? null,
    // No mandate / order yet — iframe runs in "consent" mode and the
    // Pay Now button drives placeOrder + sendPaymentInfo + authorize
    // via tools/call JSON-RPC against this same MCP server.
    checkoutUrl: cart.checkoutUrl,
    summary: response.result,
  }
}

/**
 * Build the iframe payload from the placeOrder tool response. The
 * checkout.html iframe expects a specific shape (cart.items[], mandate.id,
 * mandate.merchantDid, mandate.cartHash, …). We translate the
 * adapter's MandateInfo + CartPreviewData into that shape rather than
 * rewriting the iframe — the iframe is the demo's visual punchline and
 * stays as-is across the headless migration.
 */
function buildIframePayload(response: ToolEffectResponse): unknown {
  const cart = response.cartPreview
  const m = response.mandate

  if (!cart || !m) return response

  const shipping = Math.max(0, (cart.total ?? 0) - (cart.subtotal ?? 0))

  return {
    cart: {
      items: cart.items,
      subtotal: cart.subtotal,
      shipping: shipping || undefined,
      total: cart.total,
      currency: cart.currency,
    },
    mandate: {
      id: m.mandateId,
      merchantDid: m.signedBy,
      cartHash: m.cartHash,
      issuedAt: m.signedAt,
      mandateUrl: m.retrievalUrl,
      didUrl: m.didDocumentUrl,
    },
    order: {
      orderGroup: m.orderGroup,
      transactionId: m.transactionId,
      gatewayStatus: m.gatewayStatus,
      adminUrl: m.checkoutUrl,
    },
    checkoutUrl: m.checkoutUrl,
    summary: response.result,
  }
}

/**
 * Format a list-payment-methods response as a numbered list Claude can
 * render inline ("Reply with 1, 2, or 3 to pick"). The widget gets the
 * structured `paymentMethods` field for pill buttons; Claude Desktop
 * gets this human-readable text since there's no UI extension.
 */
/**
 * Format an authorize_transaction response as a markdown proof block
 * Claude Desktop can render inline:
 *
 *   ✓ Order 1639710533638 placed (approved)
 *
 *   CartMandate: `mandate-ed6a8cdf...`
 *   Verify:     https://.../mandates/mandate-ed6a8cdf...
 *   Admin:      https://vtexeurope.myvtex.com/admin/orders/1639710533638-01
 *
 * Mirrors the storefront widget's PlacedOrderConfirmation panel so the
 * same demo beat works in both surfaces.
 */
function formatAuthorizeResponse(response: ToolEffectResponse): string {
  const m = response.mandate

  if (!m || !m.orderGroup) {
    return response.result ?? 'authorize_transaction returned no payload.'
  }

  const statusLabel =
    m.gatewayStatus === 'approved'
      ? '✓ Order placed (approved)'
      : m.gatewayStatus === 'pending'
      ? '⏳ Order awaiting payment confirmation'
      : m.gatewayStatus === 'denied'
      ? '✗ Order denied by gateway'
      : 'Order created'

  const lines = [`${statusLabel} — \`${m.orderGroup}\``]

  if (m.mandateId) lines.push(`CartMandate: \`${m.mandateId}\``)
  if (m.retrievalUrl) lines.push(`Verify: ${m.retrievalUrl}`)
  if (m.signedBy) lines.push(`Signed by: \`${m.signedBy}\``)

  // The chat handler builds checkoutUrl as the OMS admin URL; surface it
  // as "Admin" so Claude users know it's gated by the merchant login.
  if (typeof response.result === 'string') {
    lines.push('', response.result)
  }

  return lines.join('\n')
}

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
  // ─── checkout.html MCP App resource ──────────────────────────────
  //
  // The Claude Desktop iframe ceremony. Lives at
  // ui://acg-checkout/index.html — the placeOrder tool attaches it as
  // its UI surface so Claude Desktop renders the cart + mandate +
  // 7-check ceremony alongside the chat text. Same iframe Claude
  // Desktop has always used; just re-wired to the headless flow.
  let checkoutHtml: string
  try {
    checkoutHtml = readFileSync(
      join(__dirname, '..', 'apps', 'checkout.html'),
      'utf-8'
    )
  } catch {
    try {
      checkoutHtml = readFileSync(
        join(__dirname, '..', '..', 'src', 'apps', 'checkout.html'),
        'utf-8'
      )
    } catch {
      checkoutHtml = '<html><body><p>Checkout app not found</p></body></html>'
    }
  }

  server.resource(
    CHECKOUT_APP_URI,
    CHECKOUT_APP_URI,
    { mimeType: 'text/html;profile=mcp-app' },
    async () => ({
      contents: [
        {
          uri: CHECKOUT_APP_URI,
          mimeType: 'text/html;profile=mcp-app',
          text: checkoutHtml,
        },
      ],
    })
  )

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
  //
  // Terminal in the agent's turn. After this returns Claude Desktop
  // opens the checkout iframe (cart + selected payment + Pay Now button).
  // The iframe drives placeOrder → sendPaymentInfo → authorizeTransaction
  // itself via JSON-RPC when the user clicks Pay Now.
  //
  // Tool description tells the model to STOP after this call and wait
  // for the user instead of auto-chaining placeOrder.
  const setPaymentMethodTool = server.tool(
    'setPaymentMethod',
    'Record the customer\'s chosen payment method. After this returns the user MUST confirm by clicking Pay Now in the checkout iframe that opens alongside the chat — DO NOT call placeOrder, sendPaymentInfo, or authorizeTransaction in the same turn, even if the user already said "checkout"/"hai la checkout"/"plasează comanda". Wait for the next user turn. Step 2 of the headless checkout flow.',
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
        const iframePayload = buildSetPaymentMethodIframePayload(result)

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(iframePayload) },
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

  setPaymentMethodTool._meta = {
    ui: {
      resourceUri: CHECKOUT_APP_URI,
      csp: {
        resourceDomains: [
          'vtexeurope.vteximg.com.br',
          '*.vteximg.com.br',
          'vteximg.com.br',
        ],
      },
    },
  } as any

  // ─── placeOrder ──────────────────────────────────────────────────
  //
  // Designed to be called BY THE CHECKOUT IFRAME when the user clicks
  // Pay Now (the iframe issues a tools/call JSON-RPC over the MCP
  // transport). Do not call from chat unless the user types an explicit
  // verbal confirmation like "confirmă plasarea comenzii" / "place order
  // now" — otherwise wait for the iframe.
  //
  // Signs the AP2 CartMandate AND creates the real VTEX transaction in
  // one call.
  server.tool(
    'placeOrder',
    'Create a real VTEX order: signs the AP2 CartMandate over the current cart AND posts the transaction to VTEX OMS in one call. This tool is normally driven BY THE CHECKOUT IFRAME (when the user clicks Pay Now). Do NOT call directly after setPaymentMethod unless the user types an explicit verbal "yes place it now"/"confirmă plasarea" — the iframe drives the chain on click. If you DO call it directly, follow with sendPaymentInfo then authorizeTransaction to finalize.',
    {},
    async () => {
      try {
        const result = await client.post<ToolEffectResponse>(
          '/checkout/place-order'
        )
        const iframePayload = buildIframePayload(result)

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(iframePayload),
            },
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

  // ─── sendPaymentInfo ─────────────────────────────────────────────
  server.tool(
    'sendPaymentInfo',
    'Forward payment details to the VTEX payment gateway for the open transaction. Normally called BY THE CHECKOUT IFRAME after placeOrder succeeds. Do NOT call from chat unless you explicitly drove placeOrder yourself in this turn.',
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
    'Authorize the open transaction with the gateway. Returns the final order status. Normally called BY THE CHECKOUT IFRAME at the end of the Pay Now chain. Do NOT call from chat unless you explicitly drove placeOrder + sendPaymentInfo yourself in this turn. For Cash / promissory the status is immediate; for card / redirect methods the customer continues with the provider and VTEX finalizes asynchronously.',
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
          content: [
            {
              type: 'text' as const,
              text: formatAuthorizeResponse(result),
            },
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

  console.error('[ACG] Headless checkout tools registered (5 tools: list/setPaymentMethod, placeOrder [auto-mandate], sendPaymentInfo, authorizeTransaction)')
}
