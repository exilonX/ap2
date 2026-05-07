/**
 * @acg/core — AP2 Protocol Engine
 *
 * AP2-compliant cryptographic mandate signing for agentic commerce.
 * Follows the AP2 v0.1.0 specification (Human Present scenario).
 *
 * Reference: https://github.com/google-agentic-commerce/AP2
 *
 * Usage:
 *   import { generateKeyPair, createCartMandate, verifyCartMandate } from '@acg/core';
 *
 *   const keys = generateKeyPair();
 *   const mandate = await createCartMandate(cartData, 'merchant.com', keys);
 *   const result = await verifyCartMandate(mandate, keys.publicKey);
 */

// DID management
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

// JSON Canonicalization (RFC 8785)
export {
  canonicalizeJson,
  sha256,
  sha256Bytes,
  canonicalHash,
} from './jcs';

// Key persistence
export {
  loadOrCreateIdentity,
  loadIdentityFromEnv,
  FilesystemKeyStore,
  EnvKeyStore,
  type KeyStore,
  type StoredKeys,
  type MerchantIdentity,
} from './keystore';

// Mandate management (AP2-compliant)
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

// Evidence Bundle (AP2-compliant — ties a CartMandate to its persisted record)
export {
  extractEvidenceBundle,
  type EvidenceBundle,
  type PaymentMandate,
} from './evidence';

// ─── AP2 v0.2 — PaymentMandate + PaymentReceipt + W3C PaymentRequest ─
//
// These types are mirrored line-for-line from the canonical Pydantic at
// https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/
// so the JSON wire-format is byte-equivalent to Google's reference impl.
//
// File-internal type names follow the canonical names (PaymentItem,
// PaymentResponse, etc.); the barrel re-exports them with `Ap2` prefix
// to disambiguate from the pre-W3C `PaymentItem` exported above by
// `./mandates.ts`. CartMandate stays our flat shape per the 2026-05-07
// grilling decision (Q3 → Y) — full v0.2 W3C-wrapped CartContents is
// post-demo work tracked in ISSUES.md.

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
