/**
 * Checkout Tools
 *
 * MCP tools for checkout — supports both:
 * - Path A: VTEX native checkout (browser redirect)
 * - Path B: In-chat payment via MCP App (sandboxed iframe)
 *
 * Per ADR-0001, the MCP server NEVER signs mandates locally. Both
 * `checkoutInChat` and `checkout` call `/_v/acg/checkout/initiate` and
 * the Adapter performs the merchant-side AP2 ceremony — sign, persist,
 * return the mandate id and retrieval URL. The MCP server merely
 * displays what came back.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import axios from 'axios'
import { VtexClient } from '../client'
import type { SimpleCart } from '@acg/shared/cart'

async function imageToDataUri(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 })
    const contentType = (response.headers['content-type'] || 'image/jpeg').split(';')[0]
    return `data:${contentType};base64,${Buffer.from(response.data).toString('base64')}`
  } catch { return null }
}

/**
 * Shape of the Adapter's `/checkout/initiate` response after Issue 01.
 *
 * The mandate ceremony happens server-side; the response carries the
 * mandate id and the retrieval URL the demo recording reads from.
 */
interface CheckoutInitiateResponse {
  sessionId: string
  mandateId: string
  retrievalUrl: string
  cartHash: string
  signedBy: string
  signedAt: string
  checkoutUrl: string
  directCheckoutUrl?: string
  expiresAt: string
  cart: { total: number; currency: string; itemCount: number }
  message?: string
}

const CHECKOUT_APP_URI = 'ui://acg-checkout/index.html'

export function registerCheckoutTools(server: McpServer, client: VtexClient) {
  // ─── Register MCP App HTML resource synchronously ──────────────
  let checkoutHtml: string
  try {
    checkoutHtml = readFileSync(join(__dirname, '..', 'apps', 'checkout.html'), 'utf-8')
  } catch {
    try {
      checkoutHtml = readFileSync(join(__dirname, '..', '..', 'src', 'apps', 'checkout.html'), 'utf-8')
    } catch {
      checkoutHtml = '<html><body><p>Checkout form not found</p></body></html>'
    }
  }

  // Register the HTML as a resource using the standard server.resource() API
  server.resource(
    CHECKOUT_APP_URI,
    CHECKOUT_APP_URI,
    { mimeType: 'text/html;profile=mcp-app' },
    async () => ({
      contents: [{ uri: CHECKOUT_APP_URI, mimeType: 'text/html;profile=mcp-app', text: checkoutHtml }],
    })
  )

  // ─── checkoutInChat (registered SYNCHRONOUSLY) ─────────────────
  const checkoutInChatTool = server.tool(
    'checkoutInChat',
    'Open a payment form directly in the chat to complete your purchase.',
    {},
    async () => {
      try {
        const cart = await client.get<SimpleCart>('/cart')

        // The Adapter signs the mandate. We pass no body — `/checkout/initiate`
        // doesn't accept caller-supplied mandates anymore.
        const checkoutResult = await client.post<CheckoutInitiateResponse>('/checkout/initiate').catch(() => null)

        const baseUrl = `https://${process.env.VTEX_WORKSPACE || 'master'}--${process.env.VTEX_ACCOUNT || 'store'}.myvtex.com`
        const checkoutUrl =
          checkoutResult?.checkoutUrl || `${baseUrl}/checkout/?orderFormId=${cart.id}#/cart`

        const mandateInfo = checkoutResult
          ? {
              id: checkoutResult.mandateId,
              merchantDid: checkoutResult.signedBy,
              cartHash: checkoutResult.cartHash,
              issuedAt: checkoutResult.signedAt,
              verified: true,
              mandateUrl: checkoutResult.retrievalUrl,
              didUrl: `${baseUrl}/_v/acg/.well-known/did.json`,
            }
          : null

        // Embed cart item images as base64
        const itemsWithImages = await Promise.all(
          cart.items.map(async (item) => {
            const imgUrl = item.image?.replace(/-\d+-\d+\//, '-100-100/') || item.image
            const dataUri = imgUrl ? await imageToDataUri(imgUrl) : null
            return { ...item, image: dataUri || undefined }
          })
        )

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ cart: { ...cart, items: itemsWithImages }, mandate: mandateInfo, checkoutUrl }),
          }],
        }
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to load cart' }),
          }],
          isError: true,
        }
      }
    }
  )

  // Inject _meta.ui so Claude Desktop renders the MCP App iframe
  checkoutInChatTool._meta = {
    ui: {
      resourceUri: CHECKOUT_APP_URI,
      csp: {
        resourceDomains: ['vtexeurope.vteximg.com.br', '*.vteximg.com.br', 'vteximg.com.br'],
      },
    },
  } as any

  // ─── executePayment (called from the iframe) ──────────────────
  //
  // Mandate-aware payment ceremony. Calls /payment/execute on the
  // Adapter, which runs MandateOrchestration.verifyAgainstCart against
  // the current cart and either places a mock order or rejects with a
  // drift reason.
  //
  // customerData / paymentData are still validated for the iframe's
  // form UX (theater for the demo recording) but ignored server-side
  // — the cryptographic beat happens via mandateId, not card data.
  // Issue 04 (post-demo) reconciles this with the chat-side
  // execute_payment AgentTool.
  server.tool(
    'executePayment',
    {
      mandateId: z.string().describe('The CartMandate id returned by checkoutInChat. Required.'),
      customerData: z.object({
        email: z.string(),
        firstName: z.string(),
        lastName: z.string(),
        phone: z.string().optional(),
      }).optional().describe('Customer information (theater — not used server-side)'),
      paymentData: z.object({
        cardNumber: z.string(),
        cardHolder: z.string(),
        cardExpiration: z.string(),
        cardCvv: z.string(),
      }).optional().describe('Payment card details (theater — not used server-side)'),
    },
    async (params) => {
      try {
        const result = await client.post<
          | {
              success: true
              orderId: string
              mandateId: string
              signedBy: string
              cartTotal: number
              cartCurrency: string
            }
          | {
              success: false
              reason: string
              drifted: boolean
              mandateId: string | null
            }
        >('/payment/execute', { mandateId: params.mandateId })

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                reason: `Payment error: ${message}`,
                drifted: false,
                mandateId: params.mandateId ?? null,
              }),
            },
          ],
          isError: true,
        }
      }
    }
  )

  // ─── checkout (Path A — VTEX native checkout redirect) ─────────
  server.tool('checkout', {}, async () => {
    try {
      // No body — the Adapter signs the mandate; we just receive the
      // result and display it.
      const result = await client.post<CheckoutInitiateResponse>('/checkout/initiate')

      const baseUrl = result.checkoutUrl?.split('/_v/acg/')[0] || ''

      let response =
        `Ready to complete your purchase!\n\n` +
        `**Order Summary:**\n` +
        `- Items: ${result.cart.itemCount}\n` +
        `- Total: ${result.cart.total.toFixed(2)} ${result.cart.currency}\n\n` +
        `**AP2 Mandate:** \`${result.mandateId}\`\n` +
        `- Cart Hash: \`${result.cartHash.substring(0, 16)}...\`\n` +
        `- Signed by: \`${result.signedBy}\`\n` +
        `- Signed at: ${result.signedAt}\n\n` +
        `**Mandate proof (public):** ${result.retrievalUrl}\n` +
        `**Merchant identity (DID):** ${baseUrl}/_v/acg/.well-known/did.json\n\n` +
        `**Complete checkout:** ${result.checkoutUrl}\n\n` +
        `This link expires in 10 minutes.`

      return { content: [{ type: 'text' as const, text: response }] }
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: `Error starting checkout: ${error instanceof Error ? error.message : 'Unknown error'}` }],
        isError: true,
      }
    }
  })

  // ─── checkOrderStatus ─────────────────────────────────────────
  server.tool(
    'checkOrderStatus',
    { orderId: z.string().describe('The order ID to check') },
    async (params) => {
      try {
        const result = await client.get<{ orderId: string; status: string; total: number; createdAt: string }>(`/orders/${params.orderId}`)
        return {
          content: [{ type: 'text' as const, text: `**Order ${result.orderId}**\nStatus: ${result.status}\nTotal: ${result.total.toFixed(2)}\nCreated: ${new Date(result.createdAt).toLocaleString()}` }],
        }
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error checking order: ${error instanceof Error ? error.message : 'Unknown error'}` }],
          isError: true,
        }
      }
    }
  )

  console.error('[ACG] Checkout tools registered (Path A + Path B)')
}
