/**
 * @acg/core — AP2 Protocol Engine
 *
 * Cryptographic mandate signing for agentic commerce.
 * Platform-agnostic — knows nothing about VTEX, Shopify, etc.
 *
 * Usage:
 *   import { generateKeyPair, createCartMandate, verifyCartMandate } from '@acg/core';
 *
 *   const keys = generateKeyPair();
 *   const mandate = createCartMandate(cartData, 'merchant.com', keys);
 *   const result = verifyCartMandate(mandate, keys.publicKey);
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

// Mandate management
export {
  createCartMandate,
  verifyCartMandate,
  mandateMatchesCart,
  type CartLineItem,
  type CartData,
  type CartMandate,
  type MandateVerification,
} from './mandates';
