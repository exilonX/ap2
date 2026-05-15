/**
 * MerchantIdentity — narrow signing surface for the merchant.
 *
 * Extends `IdentityHolder` (from `@acg/core`) to inherit the DID / DID
 * document / public-key accessors and the lazy `load()` helper. Adds
 * the single merchant-specific signing method: `signCartMandate`.
 *
 * Per ADR-0001, the Shopping Agent (MCP server, chat handler, widget)
 * never holds a `KeyStore` and never instantiates this class. Only the
 * Adapter does. Future remote-signer migration (KMS, HSM, vault) is a
 * swap-not-rewrite at the `KeyStore` seam.
 *
 * The private key never leaves the class — `IdentityHolder` exposes
 * only public-shaped accessors; signing methods borrow the keypair
 * inside a single operation through the protected `load()`.
 */

import { IdentityHolder, createCartMandate } from '../core'
import type { CartData, CartMandate } from '../core'

export class MerchantIdentity extends IdentityHolder {
  /**
   * Sign a CartMandate for the given cart data.
   *
   * The private key is borrowed for the duration of the call via the
   * inherited `load()` helper and never returned to the caller.
   */
  public async signCartMandate(cart: CartData): Promise<CartMandate> {
    const identity = await this.load()

    return createCartMandate(cart, identity.domain, identity.keys)
  }
}
