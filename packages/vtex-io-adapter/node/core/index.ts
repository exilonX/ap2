/**
 * @acg/core — vendored copy.
 *
 * VTEX IO can't reach `file:` deps, so the AP2 cryptographic primitives
 * from `packages/core/src/*` are vendored here. The source of truth
 * remains `packages/core/`; this directory mirrors its public surface.
 *
 * If you change anything in `packages/core/src/`, run `npm run sync-types`
 * from the repo root to refresh.
 *
 * Note: this index splits the `import type` re-exports from the value
 * re-exports rather than using inline `type` modifiers inside one
 * `export { ... }` block. The adapter's pinned Prettier parser doesn't
 * accept the inline form; the source package can use either style.
 *
 * Public surface re-exported here matches `@acg/core`:
 *   - `loadOrCreateIdentity`, `KeyStore`, `PartyIdentity`, `IdentityHolder`
 *   - `createCartMandate`, `verifyCartMandate`, `mandateMatchesCart`
 *   - `extractEvidenceBundle`, `EvidenceBundle`
 *   - PaymentMandate / PaymentReceipt factories + verifiers
 *   - DID and JCS primitives
 */

export {
  generateKeyPair,
  keyPairFromHex,
  sign,
  verify,
  createDIDDocument,
  didFromDomain,
} from './did'
export type { KeyPair, DIDDocument } from './did'

export { canonicalizeJson, sha256, sha256Bytes, canonicalHash } from './jcs'

export {
  loadOrCreateIdentity,
  loadIdentityFromEnv,
  FilesystemKeyStore,
  EnvKeyStore,
  IdentityHolder,
} from './keystore'
export type {
  KeyStore,
  StoredKeys,
  PartyIdentity,
  IdentityHolderDeps,
} from './keystore'

export {
  createCartMandate,
  verifyCartMandate,
  mandateMatchesCart,
} from './mandates'
export type {
  PaymentAmount,
  PaymentItem,
  CartContents,
  CartMandate,
  MandateJWTPayload,
  MandateVerification,
  CartLineItem,
  CartData,
} from './mandates'

export { extractEvidenceBundle } from './evidence'
export type { EvidenceBundle, PaymentMandate } from './evidence'

// ─── AP2 v0.2 — PaymentMandate + PaymentReceipt + W3C PaymentRequest ─

export {
  createPaymentMandate,
  verifyPaymentMandate,
  hashCartMandate,
  hashPaymentMandateContents,
  PAYMENT_MANDATE_DATA_KEY,
} from './ap2/payment-mandate'
export type {
  PaymentMandateContents,
  PaymentMandateJWTPayload,
  PaymentMandateVerification,
  AgentPresence,
  CreatePaymentMandateInput,
  CreatePaymentMandateOptions,
} from './ap2/payment-mandate'

export {
  createPaymentReceipt,
  verifyPaymentReceipt,
} from './ap2/payment-receipt'
export type {
  PaymentReceipt,
  PaymentReceiptContents,
  PaymentReceiptJWTPayload,
  PaymentReceiptVerification,
  VerificationChecks,
  CreatePaymentReceiptInput,
  CreatePaymentReceiptOptions,
} from './ap2/payment-receipt'

export { PAYMENT_METHOD_DATA_DATA_KEY } from './ap2/payment-request'
export type {
  PaymentItem as Ap2PaymentItem,
  PaymentCurrencyAmount as Ap2PaymentCurrencyAmount,
  PaymentResponse as Ap2PaymentResponse,
  PaymentRequest as Ap2PaymentRequest,
  PaymentMethodData as Ap2PaymentMethodData,
  PaymentDetailsInit as Ap2PaymentDetailsInit,
  PaymentDetailsModifier as Ap2PaymentDetailsModifier,
  PaymentOptions as Ap2PaymentOptions,
  PaymentShippingOption as Ap2PaymentShippingOption,
} from './ap2/payment-request'

export type { ContactAddress as Ap2ContactAddress } from './ap2/contact-address'
