/**
 * MerchantIdentity — narrow signing surface for the merchant.
 *
 * Owns "who is this merchant cryptographically?" — the keypair, the DID
 * composition, the storage of the private key. The private key is
 * loaded into module-scope memory once via the supplied `KeyStore`;
 * every signing operation runs through a method that scopes the key to
 * that single operation. **The private key is never returned to callers.**
 *
 * Per ADR-0001, the Shopping Agent (MCP server, chat handler, widget)
 * never holds a `KeyStore` and never instantiates this class. Only the
 * Adapter does. Future remote-signer migration (KMS, HSM, vault) is a
 * swap-not-rewrite at the `KeyStore` seam.
 */

import {
  loadOrCreateIdentity,
  createCartMandate,
  type CartData,
  type CartMandate,
  type DIDDocument,
  type KeyStore,
  type MerchantIdentity as CoreMerchantIdentity,
} from '../core';

export interface MerchantIdentityDeps {
  keyStore: KeyStore;
  domain: string;
}

export class MerchantIdentity {
  private cached: CoreMerchantIdentity | null = null;

  constructor(private readonly deps: MerchantIdentityDeps) {}

  /**
   * Returns the merchant DID (e.g. `did:web:vtexeurope.myvtex.com`).
   *
   * Idempotent — repeated calls do not regenerate keys.
   */
  public async getDID(): Promise<string> {
    const identity = await this.load();
    return identity.did;
  }

  /**
   * Returns the merchant's W3C DID document.
   */
  public async getDIDDocument(): Promise<DIDDocument> {
    const identity = await this.load();
    return identity.didDocument;
  }

  /**
   * Sign a CartMandate for the given cart data.
   *
   * The private key is borrowed for the duration of the call and never
   * returned to the caller.
   */
  public async signCartMandate(cart: CartData): Promise<CartMandate> {
    const identity = await this.load();
    return createCartMandate(cart, identity.domain, identity.keys);
  }

  /**
   * Returns the merchant public key — used by `MandateOrchestration`
   * to verify previously-signed mandates. Only the public half leaves
   * this module.
   */
  public async getPublicKey(): Promise<Buffer> {
    const identity = await this.load();
    return identity.keys.publicKey;
  }

  // ─── private ──────────────────────────────────────────────────────

  private async load(): Promise<CoreMerchantIdentity> {
    if (this.cached) {
      return this.cached;
    }
    const identity = await loadOrCreateIdentity(this.deps.domain, this.deps.keyStore);
    this.cached = identity;
    return identity;
  }
}
