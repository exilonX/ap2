/**
 * @acg/mock-payment-network — vendored copy.
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
 */

export { MockCredentialsProvider } from './credentials-provider'
export type { SignPaymentMandateInput } from './credentials-provider'

export { MockPaymentNetwork } from './payment-network'
export type { ApprovePaymentInput } from './payment-network'
