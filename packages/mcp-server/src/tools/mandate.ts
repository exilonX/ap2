/**
 * Mandate Tools
 *
 * The MCP server is a Shopping Agent (per `CONTEXT.md` §3) and per
 * ADR-0001 it MUST NOT hold merchant private keys. The signing
 * primitives that previously lived in this file have been removed.
 *
 * What stays here are read-side conveniences against the Adapter's
 * mandate endpoints — fetching a stored bundle, displaying the
 * merchant DID document (verifiable via `/.well-known/did.json`).
 *
 * Production verification still works end-to-end:
 *   1. Caller fetches the EvidenceBundle at `/_v/acg/mandates/:id`.
 *   2. Caller fetches the DID doc at `/_v/acg/.well-known/did.json`.
 *   3. Caller verifies the JWT signature with the published public key.
 * The Adapter's `getMandate` handler also performs verification on
 * every read and returns the result alongside the bundle.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'
import type { EvidenceBundle, MandateVerification } from '@acg/core'

interface MandateGetResponse {
  bundle: EvidenceBundle
  verification: MandateVerification & { didDocumentUrl: string }
}

export function registerMandateTools(server: McpServer, client: VtexClient) {
  /**
   * Fetch a previously-signed mandate by id and display its verification
   * status.
   *
   * The Adapter signs at `/checkout/initiate`; this tool is the read-side.
   * Useful in demos to show "the merchant signed; here's the proof URL;
   * the signature verifies."
   */
  server.tool(
    'getMandate',
    'Fetch a previously signed AP2 cart mandate by its id and return its contents plus the cryptographic verification result (signature, expiry, cart-hash integrity). Use to show or verify the signed proof of an order.',
    {
      mandateId: z.string().describe('The mandate id returned by checkout'),
    },
    async (params) => {
      try {
        const result = await client.get<MandateGetResponse>(`/mandates/${params.mandateId}`)
        const { bundle, verification } = result

        let response = `**Cart Mandate** (AP2 Protocol v0.1.0)\n\n`
        response += `Mandate ID: \`${bundle.mandateId}\`\n`
        response += `Signed by: \`${bundle.signedBy}\`\n`
        response += `Signed at: ${bundle.signedAt}\n\n`

        response += `**Cart contents (W3C PaymentItem format):**\n`
        bundle.cartMandate.contents.payment_items.forEach((item) => {
          response += `- ${item.label}`
          if (item.quantity && item.quantity > 1) response += ` x ${item.quantity}`
          response += ` — ${item.amount.value} ${item.amount.currency}\n`
        })
        response += `\n**Total: ${bundle.cartMandate.contents.total.value} ${bundle.cartMandate.contents.total.currency}**\n\n`

        response += `**Cryptographic proof (JWT / EdDSA):**\n`
        response += `- Cart Hash (SHA-256): \`${bundle.cartHash}\`\n`
        response += `- Cart expiry: ${bundle.cartMandate.contents.cart_expiry}\n\n`

        response += `**Verification result:**\n`
        response += `- JWT Signature (EdDSA): ${verification.checks.signatureValid ? 'PASS' : 'FAIL'}\n`
        response += `- Not Expired: ${verification.checks.notExpired ? 'PASS' : 'FAIL'}\n`
        response += `- Cart Hash Integrity: ${verification.checks.hashMatches ? 'PASS' : 'FAIL'}\n\n`
        response += `**Result: ${verification.valid ? 'VALID' : 'INVALID'}**`
        if (verification.error) {
          response += `\nReason: ${verification.error}`
        }
        response += `\n\nDID document: ${verification.didDocumentUrl}`

        return { content: [{ type: 'text' as const, text: response }] }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error fetching mandate: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  /**
   * Get the merchant's DID document (public key for verification).
   *
   * The DID document is served by the Adapter at
   * `/_v/acg/.well-known/did.json`. Anyone can fetch it and verify
   * any signed mandate against the public key it publishes.
   */
  server.tool(
    'getMerchantDID',
    'Return the merchant DID document — the public key anyone can use to verify the merchant signed AP2 mandates. Use when the customer wants to verify the merchant identity or how mandates are validated.',
    {},
    async () => {
    try {
      const didDoc = await client.get<unknown>('/.well-known/did.json')

      let response = `**Merchant Identity** (AP2 Protocol)\n\n`
      response += `**DID Document:**\n`
      response += `\`\`\`json\n${JSON.stringify(didDoc, null, 2)}\n\`\`\`\n\n`
      response += `Anyone can fetch this document to verify the merchant's signed mandates.`

      return { content: [{ type: 'text' as const, text: response }] }
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error fetching DID document: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      }
    }
  })
}
