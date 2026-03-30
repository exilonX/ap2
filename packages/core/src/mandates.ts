/**
 * Mandate Management
 *
 * Creates and verifies AP2 CartMandates — cryptographically signed
 * proofs that a specific cart was authorized at a specific price.
 *
 * A CartMandate is a tamper-proof receipt:
 * - Contains the exact cart contents (items, quantities, prices)
 * - Signed by the merchant's Ed25519 private key
 * - Has an expiry and nonce to prevent replay attacks
 * - Can be verified by anyone with the merchant's public key
 *
 * If the cart changes after signing, the mandate becomes invalid.
 */

import { randomBytes } from 'crypto';
import { canonicalHash, sha256Bytes } from './jcs';
import { sign, verify as verifySignature, didFromDomain, type KeyPair } from './did';

// ─── Types ───────────────────────────────────────────────────────

export interface CartLineItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface CartData {
  items: CartLineItem[];
  totalAmount: number;
  currency: string;
  orderFormId: string;
}

export interface CartMandate {
  // Mandate metadata
  mandateId: string;
  version: '0.1.0';
  type: 'CartMandate';

  // Cart contents (canonical)
  lineItems: CartLineItem[];
  totalAmount: number;
  currency: string;

  // References
  orderFormId: string;

  // Parties
  merchantDid: string;

  // Cryptographic proof
  canonicalHash: string;
  signature: string;
  signedAt: string;
  expiresAt: string;
  nonce: string;
}

export interface MandateVerification {
  valid: boolean;
  checks: {
    signatureValid: boolean;
    notExpired: boolean;
    hashMatches: boolean;
  };
  error?: string;
}

// ─── Creation ────────────────────────────────────────────────────

/**
 * Create a CartMandate from cart data.
 *
 * Steps:
 * 1. Build the canonical cart payload (only the fields that matter for price integrity)
 * 2. Canonicalize with JCS (RFC 8785) → deterministic JSON
 * 3. Hash with SHA-256
 * 4. Sign the hash with merchant's Ed25519 private key
 * 5. Return the full mandate with metadata
 *
 * @param cart - The cart data to sign
 * @param merchantDomain - The merchant's domain (for DID)
 * @param keys - The merchant's Ed25519 key pair
 * @param expiryMinutes - How long the mandate is valid (default: 10 minutes)
 */
export function createCartMandate(
  cart: CartData,
  merchantDomain: string,
  keys: KeyPair,
  expiryMinutes: number = 10
): CartMandate {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);
  const nonce = randomBytes(16).toString('hex');
  const mandateId = `mandate-${randomBytes(8).toString('hex')}`;

  // Build the canonical payload — only price-critical fields
  const canonicalPayload = {
    lineItems: cart.items.map((item) => ({
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
    totalAmount: cart.totalAmount,
    currency: cart.currency,
    orderFormId: cart.orderFormId,
    merchantDid: didFromDomain(merchantDomain),
    nonce,
    signedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  // Canonicalize and hash
  const { hash } = canonicalHash(canonicalPayload);

  // Sign the hash
  const hashBytes = sha256Bytes(hash);
  const signature = sign(hashBytes, keys.privateKey);

  return {
    mandateId,
    version: '0.1.0',
    type: 'CartMandate',
    lineItems: canonicalPayload.lineItems,
    totalAmount: cart.totalAmount,
    currency: cart.currency,
    orderFormId: cart.orderFormId,
    merchantDid: didFromDomain(merchantDomain),
    canonicalHash: hash,
    signature,
    signedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    nonce,
  };
}

// ─── Verification ────────────────────────────────────────────────

/**
 * Verify a CartMandate.
 *
 * Checks:
 * 1. Signature is valid (matches the hash, signed by the claimed DID)
 * 2. Mandate is not expired
 * 3. Canonical hash matches the mandate contents
 *
 * @param mandate - The CartMandate to verify
 * @param publicKey - The merchant's Ed25519 public key
 */
export function verifyCartMandate(
  mandate: CartMandate,
  publicKey: Buffer
): MandateVerification {
  // Check 1: Not expired
  const notExpired = new Date(mandate.expiresAt) > new Date();

  // Check 2: Reconstruct canonical hash from mandate contents
  const canonicalPayload = {
    lineItems: mandate.lineItems,
    totalAmount: mandate.totalAmount,
    currency: mandate.currency,
    orderFormId: mandate.orderFormId,
    merchantDid: mandate.merchantDid,
    nonce: mandate.nonce,
    signedAt: mandate.signedAt,
    expiresAt: mandate.expiresAt,
  };

  const { hash: recomputedHash } = canonicalHash(canonicalPayload);
  const hashMatches = recomputedHash === mandate.canonicalHash;

  // Check 3: Verify signature
  let signatureValid = false;
  try {
    const hashBytes = sha256Bytes(mandate.canonicalHash);
    signatureValid = verifySignature(mandate.signature, hashBytes, publicKey);
  } catch {
    signatureValid = false;
  }

  const valid = signatureValid && notExpired && hashMatches;

  return {
    valid,
    checks: {
      signatureValid,
      notExpired,
      hashMatches,
    },
    error: !valid
      ? !signatureValid
        ? 'Invalid signature'
        : !notExpired
          ? 'Mandate has expired'
          : 'Cart contents have been tampered with'
      : undefined,
  };
}

/**
 * Compare a mandate against current cart data.
 * Returns true if the cart hasn't changed since the mandate was signed.
 */
export function mandateMatchesCart(mandate: CartMandate, currentCart: CartData): boolean {
  if (mandate.totalAmount !== currentCart.totalAmount) return false;
  if (mandate.currency !== currentCart.currency) return false;
  if (mandate.orderFormId !== currentCart.orderFormId) return false;
  if (mandate.lineItems.length !== currentCart.items.length) return false;

  for (let i = 0; i < mandate.lineItems.length; i++) {
    const m = mandate.lineItems[i];
    const c = currentCart.items[i];
    if (m.sku !== c.sku || m.quantity !== c.quantity || m.unitPrice !== c.unitPrice) {
      return false;
    }
  }

  return true;
}
