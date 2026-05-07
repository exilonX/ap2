/**
 * @acg/core — vendored copy.
 *
 * VTEX IO can't reach `file:` deps, so the AP2 cryptographic primitives
 * from `packages/core/src/*` are vendored here. The source of truth
 * remains `packages/core/`; this directory mirrors its public surface.
 *
 * If you change anything in `packages/core/src/`, run the vendor sync
 * (or, until the script lands, manually copy the relevant files).
 *
 * Public surface re-exported from this index matches `@acg/core`:
 *   - `loadOrCreateIdentity`, `KeyStore`, `MerchantIdentity`
 *   - `createCartMandate`, `verifyCartMandate`, `mandateMatchesCart`
 *   - `extractEvidenceBundle`, `EvidenceBundle`
 *   - DID and JCS primitives
 */

export {
  generateKeyPair,
  keyPairFromHex,
  sign,
  verify,
  createDIDDocument,
  didFromDomain,
  type KeyPair,
  type DIDDocument,
} from './did';

export {
  canonicalizeJson,
  sha256,
  sha256Bytes,
  canonicalHash,
} from './jcs';

export {
  loadOrCreateIdentity,
  loadIdentityFromEnv,
  FilesystemKeyStore,
  EnvKeyStore,
  type KeyStore,
  type StoredKeys,
  type MerchantIdentity,
} from './keystore';

export {
  createCartMandate,
  verifyCartMandate,
  mandateMatchesCart,
  type PaymentAmount,
  type PaymentItem,
  type CartContents,
  type CartMandate,
  type MandateJWTPayload,
  type MandateVerification,
  type CartLineItem,
  type CartData,
} from './mandates';

export {
  extractEvidenceBundle,
  type EvidenceBundle,
  type PaymentMandate,
} from './evidence';

// ─── AP2 v0.2 — PaymentMandate + PaymentReceipt + W3C PaymentRequest ─

export {
  createPaymentMandate,
  verifyPaymentMandate,
  hashCartMandate,
  hashPaymentMandateContents,
  PAYMENT_MANDATE_DATA_KEY,
  type PaymentMandateContents,
  type PaymentMandateJWTPayload,
  type PaymentMandateVerification,
  type AgentPresence,
  type CreatePaymentMandateInput,
  type CreatePaymentMandateOptions,
} from './ap2/payment-mandate';

export {
  createPaymentReceipt,
  verifyPaymentReceipt,
  type PaymentReceipt,
  type PaymentReceiptContents,
  type PaymentReceiptJWTPayload,
  type PaymentReceiptVerification,
  type VerificationChecks,
  type CreatePaymentReceiptInput,
  type CreatePaymentReceiptOptions,
} from './ap2/payment-receipt';

export {
  type PaymentItem as Ap2PaymentItem,
  type PaymentCurrencyAmount as Ap2PaymentCurrencyAmount,
  type PaymentResponse as Ap2PaymentResponse,
  type PaymentRequest as Ap2PaymentRequest,
  type PaymentMethodData as Ap2PaymentMethodData,
  type PaymentDetailsInit as Ap2PaymentDetailsInit,
  type PaymentDetailsModifier as Ap2PaymentDetailsModifier,
  type PaymentOptions as Ap2PaymentOptions,
  type PaymentShippingOption as Ap2PaymentShippingOption,
  PAYMENT_METHOD_DATA_DATA_KEY,
} from './ap2/payment-request';

export {
  type ContactAddress as Ap2ContactAddress,
} from './ap2/contact-address';
