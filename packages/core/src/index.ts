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
