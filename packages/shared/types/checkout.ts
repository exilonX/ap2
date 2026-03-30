/**
 * Checkout flow types
 * Demo: Simple flow with test payment
 * Future: Full AP2 mandate flow
 */

export interface CheckoutInitiation {
  sessionId: string;       // Unique checkout session
  checkoutUrl: string;     // URL that sets cookie + redirects to VTEX native checkout
  directCheckoutUrl: string; // Direct VTEX checkout URL with orderFormId query param
  expiresAt: string;       // ISO timestamp - session expiry
  cart: {
    total: number;
    currency: string;
    itemCount: number;
  };
  message: string;         // "Click the checkout link to complete your purchase"
}

export interface CheckoutSession {
  id: string;
  orderFormId: string;     // VTEX orderForm reference
  createdAt: number;       // Unix timestamp
  expiresAt: number;       // Unix timestamp
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'expired';

  // Set after completion
  orderId?: string;
  transactionId?: string;
  error?: string;
}

export interface CheckoutResult {
  success: boolean;
  orderId?: string;
  orderNumber?: string;    // Human-readable order number
  transactionId?: string;
  message: string;
  error?: string;
}

// ─── AP2 Mandate Types ───────────────────────────────────────────

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
  canonicalHash: string;    // SHA-256 of JCS-canonicalized cart
  signature: string;        // Ed25519 signature over the hash
  signedAt: string;         // ISO timestamp
  expiresAt: string;        // ISO timestamp
  nonce: string;            // Replay protection
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

export interface PaymentMandate {
  cartMandateId: string;
  cartMandateHash: string;

  humanPresent: boolean;
  paymentMethod: string;
  paymentToken?: string;   // Encrypted token from Google Pay, etc.

  signature: string;
  signedAt: string;
}

/**
 * Future: 3DS2 Challenge handling
 */
export interface ChallengeRequired {
  status: 'challenge_required';
  challengeUrl: string;
  challengeType: 'redirect' | 'iframe' | 'oob';
  transactionId: string;
}
