/**
 * Mandate Tools
 *
 * MCP tools for AP2 mandate operations.
 * Creates AP2-compliant CartMandates with JWT-based merchant authorization.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'
import {
  loadOrCreateIdentity,
  createCartMandate,
  verifyCartMandate,
  type MerchantIdentity,
  type CartMandate,
} from '@acg/core'
import type { SimpleCart } from '@acg/shared/cart'
import { join } from 'path'
import { homedir } from 'os'

// Merchant identity — loaded once, persisted across calls
let merchantIdentity: MerchantIdentity | null = null;

// Last created mandate — kept in memory for verification
let lastMandate: CartMandate | null = null;

/**
 * Get the last created mandate (used by checkout tool).
 */
export function getLastMandate(): CartMandate | null {
  return lastMandate;
}

/**
 * Set the last mandate (used by checkout tool when auto-signing).
 */
export function setLastMandate(mandate: CartMandate): void {
  lastMandate = mandate;
}

function getIdentity(): MerchantIdentity {
  if (!merchantIdentity) {
    const domain = `${process.env.VTEX_WORKSPACE || 'master'}--${process.env.VTEX_ACCOUNT || 'store'}.myvtex.com`;
    const keyPath = join(homedir(), '.acg', 'keys', 'merchant.json');
    merchantIdentity = loadOrCreateIdentity(domain, keyPath);
  }
  return merchantIdentity;
}

export function registerMandateTools(server: McpServer, client: VtexClient) {
  /**
   * Create an AP2-compliant CartMandate for the current cart.
   * Signs the cart contents with a JWT (EdDSA algorithm) per the AP2 specification.
   * Use this before checkout to create a tamper-proof proof of authorization.
   */
  server.tool('createCartMandate', {}, async () => {
    try {
      const cart = await client.get<SimpleCart>('/cart')

      if (!cart.items || cart.items.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Cannot create mandate — cart is empty. Add items first.',
          }],
          isError: true,
        }
      }

      const identity = getIdentity();

      const cartData = {
        items: cart.items.map((item) => ({
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
        totalAmount: cart.total,
        currency: cart.currency,
        orderFormId: cart.id,
      };

      const mandate = await createCartMandate(cartData, identity.domain, identity.keys);
      lastMandate = mandate;

      // Decode JWT payload for display
      const jwtParts = mandate.merchant_authorization.split('.');
      const jwtPayload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString());

      let response = `**Cart Mandate Created** (AP2 Protocol v0.1.0)\n\n`
      response += `Mandate ID: \`${mandate.contents.id}\`\n`
      response += `Merchant DID: \`${mandate.contents.merchant_name}\`\n\n`

      response += `**Signed Cart Contents (W3C PaymentItem format):**\n`
      mandate.contents.payment_items.forEach((item) => {
        response += `- ${item.label}`
        if (item.quantity && item.quantity > 1) response += ` x ${item.quantity}`
        response += ` — ${item.amount.value} ${item.amount.currency}\n`
      })
      response += `\n**Total: ${mandate.contents.total.value} ${mandate.contents.total.currency}**\n\n`

      response += `**Cryptographic Proof (JWT / EdDSA):**\n`
      response += `- Algorithm: EdDSA (Ed25519)\n`
      response += `- Cart Hash (SHA-256): \`${jwtPayload.cart_hash}\`\n`
      response += `- JWT ID: \`${jwtPayload.jti}\`\n`
      response += `- Issued: ${new Date(jwtPayload.iat * 1000).toISOString()}\n`
      response += `- Expires: ${mandate.contents.cart_expiry}\n\n`

      response += `**JWT Token:** \`${mandate.merchant_authorization.substring(0, 40)}...\`\n\n`

      response += `This mandate cryptographically locks the cart at this exact price. `
      response += `Any change to items, quantities, or prices invalidates the signature.`

      return {
        content: [{ type: 'text' as const, text: response }],
      }
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error creating mandate: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }],
        isError: true,
      }
    }
  })

  /**
   * Verify the last created CartMandate.
   * Checks JWT signature validity, expiration, and cart hash integrity.
   */
  server.tool('verifyMandate', {
    mandateId: z.string().optional().describe('Mandate ID to verify (uses last created if not specified)'),
  }, async (params) => {
    try {
      if (!lastMandate) {
        return {
          content: [{
            type: 'text' as const,
            text: 'No mandate to verify. Create one first with createCartMandate.',
          }],
          isError: true,
        }
      }

      const identity = getIdentity();
      const result = await verifyCartMandate(lastMandate, identity.keys.publicKey);

      let response = `**Mandate Verification** (AP2 Protocol)\n\n`
      response += `Mandate ID: \`${lastMandate.contents.id}\`\n\n`

      response += `**Checks:**\n`
      response += `- JWT Signature (EdDSA): ${result.checks.signatureValid ? 'PASS' : 'FAIL'}\n`
      response += `- Not Expired: ${result.checks.notExpired ? 'PASS' : 'FAIL'}\n`
      response += `- Cart Hash Integrity: ${result.checks.hashMatches ? 'PASS' : 'FAIL'}\n\n`

      response += `**Result: ${result.valid ? 'VALID' : 'INVALID'}**`
      if (result.error) {
        response += `\nReason: ${result.error}`
      }

      return {
        content: [{ type: 'text' as const, text: response }],
      }
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error verifying mandate: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }],
        isError: true,
      }
    }
  })

  /**
   * Get the merchant's DID document (public key for verification).
   */
  server.tool('getMerchantDID', {}, async () => {
    try {
      const identity = getIdentity();

      let response = `**Merchant Identity** (AP2 Protocol)\n\n`
      response += `DID: \`${identity.did}\`\n`
      response += `Domain: ${identity.domain}\n\n`
      response += `**DID Document:**\n`
      response += `\`\`\`json\n${JSON.stringify(identity.didDocument, null, 2)}\n\`\`\`\n\n`
      response += `This document is published at:\n`
      response += `\`https://${identity.domain}/_v/acg/.well-known/did.json\``

      return {
        content: [{ type: 'text' as const, text: response }],
      }
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error getting DID: ${error instanceof Error ? error.message : 'Unknown error'}`,
        }],
        isError: true,
      }
    }
  })
}
