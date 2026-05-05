/**
 * MandateOrchestration — single owner of the merchant-side AP2 ceremony.
 *
 * Composes:
 *   - `MerchantIdentity` (signing + identity)
 *   - `@acg/core/extractEvidenceBundle` (deterministic bundle shape)
 *   - `@acg/core/verifyCartMandate` (verification primitive)
 *   - `@acg/core/mandateMatchesCart` (drift detection primitive)
 *   - VBase persistence (the platform-specific bit)
 *
 * Persistence layout: VBase bucket `acg-mandates`, key = `mandateId`.
 *
 * Public surface:
 *   - `signAndPersist(cart, metadata)`         → EvidenceBundle
 *   - `retrieve(mandateId)`                    → EvidenceBundle | null
 *   - `verify(mandateId)`                      → MandateVerification
 *   - `verifyAgainstCart(mandateId, cart)`     → composed result
 */

import {
  extractEvidenceBundle,
  mandateMatchesCart,
  verifyCartMandate,
  type CartData,
  type EvidenceBundle,
  type MandateVerification,
} from '../core';
import type { MerchantIdentity } from '../identity/merchant-identity';
import type { VBaseClient } from '../identity/vbase-keystore';
import type { SimpleCart } from '../types/shared';

export const MANDATE_BUCKET = 'acg-mandates';

export interface MandateOrchestrationDeps {
  identity: MerchantIdentity;
  vbase: VBaseClient;
}

/**
 * Result of `verifyAgainstCart`: combines the structural mandate
 * verification with the drift-detection comparison.
 */
export interface MandateVsCartResult {
  verification: MandateVerification;
  cartMatches: boolean;
  reason?: string;
}

export class MandateOrchestration {
  constructor(private readonly deps: MandateOrchestrationDeps) {}

  /**
   * Sign a cart and persist the resulting EvidenceBundle.
   *
   * `metadata` carries platform-specific context (e.g. VTEX
   * `sessionId`, `orderFormId`) and lands in the bundle's `metadata`
   * field unchanged.
   */
  public async signAndPersist(
    cart: SimpleCart,
    metadata?: Record<string, unknown>
  ): Promise<EvidenceBundle> {
    const cartData = simpleCartToCartData(cart);
    const cartMandate = await this.deps.identity.signCartMandate(cartData);
    const base = extractEvidenceBundle(cartMandate);
    const bundle: EvidenceBundle = { ...base, metadata };
    await this.deps.vbase.saveJSON<EvidenceBundle>(MANDATE_BUCKET, bundle.mandateId, bundle);
    return bundle;
  }

  /**
   * Retrieve a previously-persisted EvidenceBundle. Returns null when
   * the bundle doesn't exist (so callers can decide their own response
   * shape rather than handling a thrown 404).
   */
  public async retrieve(mandateId: string): Promise<EvidenceBundle | null> {
    try {
      const bundle = await this.deps.vbase.getJSON<EvidenceBundle>(
        MANDATE_BUCKET,
        mandateId,
        true
      );
      return bundle ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Verify a stored mandate's signature, expiry, and hash integrity.
   *
   * Returns a structured result. Unknown mandate IDs return
   * `{ valid: false, ..., error: 'mandate not found' }` — the method
   * does not throw.
   */
  public async verify(mandateId: string): Promise<MandateVerification> {
    const bundle = await this.retrieve(mandateId);
    if (!bundle) {
      return {
        valid: false,
        checks: { signatureValid: false, notExpired: false, hashMatches: false },
        error: 'mandate not found',
      };
    }
    const publicKey = await this.deps.identity.getPublicKey();
    return verifyCartMandate(bundle.cartMandate, publicKey);
  }

  /**
   * Re-confirm that a stored mandate still matches a current cart.
   *
   * Combines `verify` (signature/expiry/hash) with
   * `mandateMatchesCart` (item/total drift). Returns both verdicts so
   * the caller can choose the gating policy.
   *
   * `reason` is set when `cartMatches` is false; it names the drifted
   * dimension (item count, total, per-item SKU/qty/price, currency,
   * orderFormId) so logs and error messages can be specific.
   */
  public async verifyAgainstCart(
    mandateId: string,
    currentCart: SimpleCart
  ): Promise<MandateVsCartResult> {
    const bundle = await this.retrieve(mandateId);
    if (!bundle) {
      return {
        verification: {
          valid: false,
          checks: { signatureValid: false, notExpired: false, hashMatches: false },
          error: 'mandate not found',
        },
        cartMatches: false,
        reason: 'mandate not found',
      };
    }

    const publicKey = await this.deps.identity.getPublicKey();
    const verification = await verifyCartMandate(bundle.cartMandate, publicKey);

    const cartData = simpleCartToCartData(currentCart);
    const cartMatches = mandateMatchesCart(bundle.cartMandate, cartData);

    let reason: string | undefined;
    if (!cartMatches) {
      reason = describeDrift(bundle.cartMandate, cartData);
    }

    return { verification, cartMatches, reason };
  }
}

// ─── helpers ──────────────────────────────────────────────────────────

/**
 * Adapter-private: collapse a SimpleCart into the @acg/core CartData
 * shape. SimpleCart is the lingua franca across the Adapter; CartData
 * is the input @acg/core's signing primitive expects.
 */
function simpleCartToCartData(cart: SimpleCart): CartData {
  return {
    items: cart.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    })),
    totalAmount: cart.total,
    currency: cart.currency,
    orderFormId: cart.id,
  };
}

/**
 * Inspect the mandate vs the current cart and return a short
 * description of which dimension drifted.
 *
 * Mirrors the comparison order in `@acg/core/mandateMatchesCart` so the
 * reason matches the dimension that actually flipped the comparison.
 */
function describeDrift(
  mandate: import('../core').CartMandate,
  cart: CartData
): string {
  const c = mandate.contents;
  if (c.total.value !== cart.totalAmount.toFixed(2)) {
    return `total drifted: signed ${c.total.value}, current ${cart.totalAmount.toFixed(2)}`;
  }
  if (c.total.currency !== cart.currency) {
    return `currency drifted: signed ${c.total.currency}, current ${cart.currency}`;
  }
  if (c.order_reference !== cart.orderFormId) {
    return `orderFormId drifted: signed ${c.order_reference}, current ${cart.orderFormId}`;
  }
  if (c.payment_items.length !== cart.items.length) {
    return `item count drifted: signed ${c.payment_items.length}, current ${cart.items.length}`;
  }
  for (let i = 0; i < c.payment_items.length; i++) {
    const m = c.payment_items[i];
    const x = cart.items[i];
    if (m.sku !== x.sku) {
      return `item ${i} SKU drifted: signed ${m.sku}, current ${x.sku}`;
    }
    if (m.quantity !== x.quantity) {
      return `item ${i} (sku ${x.sku}) quantity drifted: signed ${m.quantity}, current ${x.quantity}`;
    }
    const expected = (x.unitPrice * x.quantity).toFixed(2);
    if (m.amount.value !== expected) {
      return `item ${i} (sku ${x.sku}) price drifted: signed ${m.amount.value}, current ${expected}`;
    }
  }
  return 'unknown drift';
}
