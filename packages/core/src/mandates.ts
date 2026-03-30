/**
 * Mandate Management — AP2 Protocol Compliant
 *
 * Creates and verifies CartMandates following the AP2 specification:
 * - CartMandate has nested structure: { contents, merchant_authorization }
 * - merchant_authorization is a JWT (EdDSA algorithm) containing a cart_hash
 * - Cart items use W3C PaymentItem-compatible format
 * - JCS (RFC 8785) canonicalization for deterministic cart_hash
 *
 * Reference: https://github.com/google-agentic-commerce/AP2
 * Spec: AP2 v0.1.0 — Human Present scenario
 */

import { randomBytes, createPrivateKey, createPublicKey } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { canonicalHash } from './jcs';
import { didFromDomain, type KeyPair } from './did';

// ─── AP2-Aligned Types ───────────────────────────────────────────

/** W3C PaymentCurrencyAmount compatible */
export interface PaymentAmount {
  currency: string;
  value: string; // String representation per W3C spec
}

/** W3C PaymentItem compatible, extended with commerce fields */
export interface PaymentItem {
  label: string;
  amount: PaymentAmount;
  sku?: string;
  quantity?: number;
}

/** Cart contents — the data that gets hashed and signed */
export interface CartContents {
  id: string;                    // Unique cart/mandate ID
  merchant_name: string;         // Merchant identifier
  payment_items: PaymentItem[];  // W3C PaymentItem array
  total: PaymentAmount;          // Total amount
  cart_expiry: string;           // ISO timestamp
  order_reference?: string;      // Platform-specific reference (e.g., VTEX orderFormId)
}

/** AP2 CartMandate — nested structure per spec */
export interface CartMandate {
  contents: CartContents;
  merchant_authorization: string; // JWT (base64url-encoded)
}

/** JWT payload claims inside merchant_authorization */
export interface MandateJWTPayload {
  iss: string;     // Merchant DID
  sub: string;     // Cart/mandate ID
  aud: string;     // Target audience (e.g., "ap2")
  iat: number;     // Issued at (unix timestamp)
  exp: number;     // Expires at (unix timestamp)
  jti: string;     // JWT ID (nonce for replay protection)
  cart_hash: string; // SHA-256 of JCS-canonicalized CartContents
}

/** Result of mandate verification */
export interface MandateVerification {
  valid: boolean;
  checks: {
    signatureValid: boolean;
    notExpired: boolean;
    hashMatches: boolean;
  };
  payload?: MandateJWTPayload;
  error?: string;
}

// ─── Input types (from our platform adapters) ────────────────────

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

// ─── Creation ────────────────────────────────────────────────────

/**
 * Create an AP2-compliant CartMandate.
 *
 * Steps:
 * 1. Convert platform cart data to W3C PaymentItem format
 * 2. Build CartContents (the canonical cart representation)
 * 3. Canonicalize CartContents with JCS (RFC 8785)
 * 4. Hash with SHA-256 → cart_hash
 * 5. Create JWT with EdDSA signature containing cart_hash
 * 6. Return { contents, merchant_authorization: jwt }
 */
export async function createCartMandate(
  cart: CartData,
  merchantDomain: string,
  keys: KeyPair,
  expiryMinutes: number = 10
): Promise<CartMandate> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiryMinutes * 60;
  const jti = randomBytes(16).toString('hex');
  const mandateId = `mandate-${randomBytes(8).toString('hex')}`;
  const merchantDid = didFromDomain(merchantDomain);

  // Convert platform items to W3C PaymentItem format
  const paymentItems: PaymentItem[] = cart.items.map((item) => ({
    label: item.name,
    amount: {
      currency: cart.currency,
      value: (item.unitPrice * item.quantity).toFixed(2),
    },
    sku: item.sku,
    quantity: item.quantity,
  }));

  // Build CartContents
  const contents: CartContents = {
    id: mandateId,
    merchant_name: merchantDid,
    payment_items: paymentItems,
    total: {
      currency: cart.currency,
      value: cart.totalAmount.toFixed(2),
    },
    cart_expiry: new Date(exp * 1000).toISOString(),
    order_reference: cart.orderFormId,
  };

  // Canonicalize and hash the contents
  const { hash: cartHash } = canonicalHash(contents);

  // Create JWT with Ed25519 (EdDSA) signature
  const privateKeyObject = createPrivateKey({
    key: keys.privateKey,
    format: 'der',
    type: 'pkcs8',
  });

  const jwt = await new SignJWT({ cart_hash: cartHash } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(merchantDid)
    .setSubject(mandateId)
    .setAudience('ap2')
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(privateKeyObject);

  return {
    contents,
    merchant_authorization: jwt,
  };
}

// ─── Verification ────────────────────────────────────────────────

/**
 * Verify an AP2 CartMandate.
 *
 * Checks:
 * 1. JWT signature is valid (EdDSA, signed by merchant's public key)
 * 2. JWT is not expired
 * 3. cart_hash in JWT matches the SHA-256 of canonicalized CartContents
 */
export async function verifyCartMandate(
  mandate: CartMandate,
  publicKey: Buffer
): Promise<MandateVerification> {
  let signatureValid = false;
  let notExpired = false;
  let hashMatches = false;
  let payload: MandateJWTPayload | undefined;

  // Check 1 & 2: Verify JWT signature and expiration
  try {
    const publicKeyObject = createPublicKey({
      key: publicKey,
      format: 'der',
      type: 'spki',
    });

    const result = await jwtVerify(mandate.merchant_authorization, publicKeyObject, {
      algorithms: ['EdDSA'],
      audience: 'ap2',
    });

    signatureValid = true;
    notExpired = true; // jwtVerify throws if expired
    payload = result.payload as unknown as MandateJWTPayload;
  } catch (error: unknown) {
    const errCode = (error as { code?: string })?.code;
    if (errCode === 'ERR_JWT_EXPIRED') {
      // Signature was valid but token expired
      signatureValid = true;
      notExpired = false;
      // Decode payload without verification for hash check
      try {
        const parts = mandate.merchant_authorization.split('.');
        payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as MandateJWTPayload;
      } catch {
        // Can't decode payload
      }
    }
    // Otherwise signatureValid stays false
  }

  // Check 3: Verify cart_hash matches contents
  if (payload?.cart_hash) {
    const { hash: recomputedHash } = canonicalHash(mandate.contents);
    hashMatches = recomputedHash === payload.cart_hash;
  }

  const valid = signatureValid && notExpired && hashMatches;

  return {
    valid,
    checks: {
      signatureValid,
      notExpired,
      hashMatches,
    },
    payload,
    error: !valid
      ? !signatureValid
        ? 'Invalid JWT signature'
        : !notExpired
          ? 'Mandate JWT has expired'
          : 'Cart contents have been tampered with (hash mismatch)'
      : undefined,
  };
}

/**
 * Compare a mandate against current cart data.
 * Returns true if the cart hasn't changed since the mandate was signed.
 */
export function mandateMatchesCart(mandate: CartMandate, currentCart: CartData): boolean {
  const contents = mandate.contents;

  // Check total
  if (contents.total.value !== currentCart.totalAmount.toFixed(2)) return false;
  if (contents.total.currency !== currentCart.currency) return false;

  // Check order reference
  if (contents.order_reference !== currentCart.orderFormId) return false;

  // Check item count
  if (contents.payment_items.length !== currentCart.items.length) return false;

  // Check each item
  for (let i = 0; i < contents.payment_items.length; i++) {
    const mandateItem = contents.payment_items[i];
    const cartItem = currentCart.items[i];
    if (mandateItem.sku !== cartItem.sku) return false;
    if (mandateItem.quantity !== cartItem.quantity) return false;
    const expectedValue = (cartItem.unitPrice * cartItem.quantity).toFixed(2);
    if (mandateItem.amount.value !== expectedValue) return false;
  }

  return true;
}
