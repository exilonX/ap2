/**
 * MockCredentialsProvider
 *
 * Mock AP2 Credentials Provider for the demo. Plays the role of "the
 * party that holds the user's payment instruments and signs PaymentMandate
 * on the user's behalf." Each instance owns its own DID + keypair via
 * the `KeyStore` interface from `@acg/core` — same pattern that the
 * Adapter uses for the merchant identity (per ADR-0001).
 *
 * Production swap-in: the real CP would be a separate service the
 * Adapter calls (Google Pay / wallet / issuer-tokenized credentials).
 * The interface here is the seam — replace the impl, keep the calling
 * code unchanged.
 *
 * Deviation from AP2 v0.2 spec (documented in AP2_COMPLIANCE.md):
 *   - user_authorization is an Ed25519 JWS, not a full sd-jwt-vc with
 *     KB-JWT. The cryptographic content (signature over transaction_data)
 *     is equivalent. v1.x post-demo work adopts sd-jwt-vc properly.
 */

import {
  createPaymentMandate,
  loadOrCreateIdentity,
  type AgentPresence,
  type Ap2PaymentItem,
  type Ap2PaymentResponse,
  type CartMandate,
  type DIDDocument,
  type KeyStore,
  type MerchantIdentity as Identity,
  type PaymentMandate,
} from '../core';

export interface MockCredentialsProviderDeps {
  /** KeyStore the CP's keypair is persisted through. */
  keyStore: KeyStore;
  /** Domain for the CP's DID (e.g. "mock-cp.acg.example"). */
  domain: string;
}

export interface SignPaymentMandateInput {
  cartMandate: CartMandate;
  payment_details_total: Ap2PaymentItem;
  payment_response: Ap2PaymentResponse;
  /** Merchant DID — populated as `merchant_agent` in the contents. */
  merchant_agent: string;
  agent_presence: AgentPresence;
}

export class MockCredentialsProvider {
  private cached: Identity | null = null;

  constructor(private readonly deps: MockCredentialsProviderDeps) {}

  /** This CP's DID (e.g. "did:web:mock-cp.acg.example"). */
  public async getDID(): Promise<string> {
    return (await this.load()).did;
  }

  /**
   * The CP's published DID document. Anyone with this can verify a
   * PaymentMandate's `user_authorization` JWT independently — same
   * trust beat as the merchant DID.
   */
  public async getDIDDocument(): Promise<DIDDocument> {
    return (await this.load()).didDocument;
  }

  /**
   * The CP's public key. Exposed for callers (e.g. the Network) that
   * want to verify a PaymentMandate without re-fetching the DID document.
   */
  public async getPublicKey(): Promise<Buffer> {
    return (await this.load()).keys.publicKey;
  }

  /**
   * Sign a PaymentMandate on the user's behalf. The CP attests that
   * the user authorized this payment over the linked CartMandate. The
   * `transaction_data` claim cryptographically binds the two artifacts.
   *
   * Production CP would require a real user-device tap-confirm before
   * signing. This mock signs unconditionally — the demo's recording
   * narrative is still honest because the `agent_presence` flags travel
   * through, and the case study calls out the simplification.
   */
  public async signPaymentMandate(input: SignPaymentMandateInput): Promise<PaymentMandate> {
    const identity = await this.load();
    return createPaymentMandate(input, {
      cpDID: identity.did,
      cpKeys: identity.keys,
    });
  }

  private async load(): Promise<Identity> {
    if (this.cached) return this.cached;
    this.cached = await loadOrCreateIdentity(this.deps.domain, this.deps.keyStore);
    return this.cached;
  }
}
