/**
 * @acg/mock-payment-network
 *
 * Mock AP2 Credentials Provider + Payment Network for the ACG demo.
 * Both classes extend `IdentityHolder` from `@acg/core` for the keyed-
 * party scaffolding (DID, DID document, lazy keypair load), and add
 * their role's signing method on top. Each instance therefore holds
 * its own DID + Ed25519 keypair via the `KeyStore` interface — same
 * pattern that the Adapter's `MerchantIdentity` uses (per ADR-0001).
 *
 * The Adapter wires both classes with `VBaseKeyStore` instances
 * scoped to separate buckets so each party persists across requests
 * with a stable DID.
 *
 * Production swap-in: replace these classes with adapters for real
 * services (Google Pay / wallet, Visa Intelligent Commerce, etc.).
 * The interface is the seam; the calling code stays unchanged.
 */

export { MockCredentialsProvider } from './credentials-provider';
export { MockPaymentNetwork } from './payment-network';
export { verifyChain, firstFailingCheck } from './verify-chain';

export type {
  SignPaymentMandateInput,
  ApprovePaymentInput,
  VerifyChainInput,
} from './types';
