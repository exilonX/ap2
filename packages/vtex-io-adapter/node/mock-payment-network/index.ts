/**
 * @acg/mock-payment-network
 *
 * Mock AP2 Credentials Provider + Payment Network for the ACG demo.
 * Each role (`MockCredentialsProvider`, `MockPaymentNetwork`) holds
 * its own DID + Ed25519 keypair via the `KeyStore` interface from
 * `@acg/core` — same pattern that the Adapter uses for the merchant
 * identity per ADR-0001.
 *
 * The Adapter wires both classes with `VBaseKeyStore` instances
 * scoped to separate buckets so each party persists across requests
 * with a stable DID.
 *
 * Production swap-in: replace these classes with adapters for real
 * services (Google Pay / wallet, Visa Intelligent Commerce, etc.).
 * The interface is the seam; the calling code stays unchanged.
 */

export {
  MockCredentialsProvider,
  type MockCredentialsProviderDeps,
  type SignPaymentMandateInput,
} from './credentials-provider';

export {
  MockPaymentNetwork,
  type MockPaymentNetworkDeps,
  type ApprovePaymentInput,
} from './payment-network';
