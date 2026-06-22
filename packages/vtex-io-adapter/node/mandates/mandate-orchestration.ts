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

import type { CartData, EvidenceBundle, MandateVerification } from '../core'
import {
  extractEvidenceBundle,
  mandateMatchesCart,
  verifyCartMandate,
} from '../core'
import type { MerchantIdentity } from '../identity/merchant-identity'
import type { VBaseClient } from '../identity/vbase-keystore'
import type { SimpleCart } from '../types/shared'

export const MANDATE_BUCKET = 'acg-mandates'

/**
 * VBase bucket where per-orderForm in-flight state is stored.
 *
 * Background: VTEX Checkout's `orderForm.customData` would have been
 * the natural home for these fields, but writing to it requires a
 * pre-registered custom app (the namespace must exist in the merchant's
 * checkout-UI config), and the only documented write endpoint is per
 * single field. Attempts to PUT the whole namespace return 404.
 *
 * Instead, we key state on `orderFormId` in a dedicated VBase bucket.
 * This is the same VBase the mandate bundles already live in, so no
 * new infra and no checkout-UI plumbing.
 *
 * The future PPP connector will read these same fields back during its
 * `authorize` callback — same bucket, same key, same shape.
 */
export const ORDERFORM_STATE_BUCKET = 'acg-orderform-state'

/**
 * VBase bucket where finalized orders' mandate refs are indexed by
 * `orderGroup` (the OMS-side identifier).
 *
 * Why a separate bucket from `acg-orderform-state`: that one is keyed by
 * `orderFormId` (a pre-order, ephemeral identifier). A future PPP payment
 * connector receives an `orderId` / `orderGroup` in its authorize callback
 * and has NO way back to the originating orderFormId — so we need an
 * index keyed by what the connector actually has.
 *
 * Lifecycle:
 *   - written by `place_order` immediately after VTEX's `/transaction`
 *     POST returns (we have both orderGroup and cartMandateId at that
 *     point)
 *   - read by the PPP connector during its `authorize` callback, and by
 *     the public `GET /_v/acg/mandates/by-order/:orderGroup` lookup route
 *
 * Shape mirrors `Ap2CustomData` but trimmed to the lookup-only fields a
 * downstream verifier needs.
 */
export const ORDER_MANDATE_INDEX_BUCKET = 'acg-order-mandate-index'

/**
 * Shape of the per-orderForm state record persisted to
 * `ORDERFORM_STATE_BUCKET` keyed by `orderFormId`.
 *
 * Built up across the checkout flow:
 *   - `cartMandateId`, `didDocumentUrl`, `signedAt` — written by
 *     `place_order`'s auto-sign step (or by `create_cart_mandate` if
 *     the LLM still calls it explicitly).
 *   - `transactionId`, `orderGroup` — written by `place_order` after
 *     the VTEX transaction is created, consumed by `send_payment_info`
 *     and `authorize_transaction`.
 */
export interface Ap2CustomData {
  cartMandateId?: string
  didDocumentUrl?: string
  signedAt?: string
  transactionId?: string
  orderGroup?: string
  /**
   * Mirrors `placeOrder`'s `merchantTransactions[0].merchantName`. Stored
   * here because `send_payment_info` builds the payments-gateway payload
   * with this exact string in `transaction.merchantName`, and the value
   * may differ from `ctx.vtex.account.toUpperCase()` on multi-seller stores.
   */
  merchantName?: string
}

/**
 * Persist (overwrite) the per-orderForm state record.
 *
 * Each call replaces the record wholesale. To do a partial update,
 * read the existing record, merge externally, and pass the merged
 * object — see how `place_order` layers `transactionId` / `orderGroup`
 * on top of the mandate fields.
 */
export async function saveOrderFormState(
  vbase: VBaseClient,
  orderFormId: string,
  data: Ap2CustomData
): Promise<void> {
  // Strip undefined so the JSON is tight on the wire and so partial
  // updates don't clobber unset fields with `null`.
  const fields: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) fields[k] = v
  }

  await vbase.saveJSON(ORDERFORM_STATE_BUCKET, orderFormId, fields)
}

/**
 * Invalidate any signed-mandate / placement state recorded for this
 * orderForm. Call when the cart is MODIFIED after a mandate was signed or an
 * order was placed: VTEX may hand the SAME orderFormId back for a new
 * purchase, and stale cartMandateId / transactionId / orderGroup must not
 * leak into the next checkout — otherwise place_order's idempotency backstop
 * treats the NEW cart as "already placed" (fake confirmation, no real order),
 * or re-uses a mandate signed against the OLD cart hash.
 *
 * No-ops (no write) when nothing is recorded.
 */
export async function clearOrderFormState(
  vbase: VBaseClient,
  orderFormId: string
): Promise<void> {
  const existing = await readOrderFormState(vbase, orderFormId).catch(
    () => ({} as Ap2CustomData)
  )

  if (
    !existing.cartMandateId &&
    !existing.transactionId &&
    !existing.orderGroup
  ) {
    return
  }

  await saveOrderFormState(vbase, orderFormId, {})
}

/**
 * Read back the per-orderForm state record. Returns an empty object
 * when nothing is present (so callers can treat "no record yet" as
 * "fresh cart" without 404 handling).
 */
export async function readOrderFormState(
  vbase: VBaseClient,
  orderFormId: string
): Promise<Ap2CustomData> {
  const fields = await vbase
    .getJSON<Record<string, unknown> | null>(
      ORDERFORM_STATE_BUCKET,
      orderFormId,
      true
    )
    .catch(() => null)

  if (!fields) return {}

  const out: Ap2CustomData = {}

  if (typeof fields.cartMandateId === 'string') {
    out.cartMandateId = fields.cartMandateId
  }

  if (typeof fields.didDocumentUrl === 'string') {
    out.didDocumentUrl = fields.didDocumentUrl
  }

  if (typeof fields.signedAt === 'string') out.signedAt = fields.signedAt
  if (typeof fields.transactionId === 'string') {
    out.transactionId = fields.transactionId
  }

  if (typeof fields.orderGroup === 'string') out.orderGroup = fields.orderGroup
  if (typeof fields.merchantName === 'string') {
    out.merchantName = fields.merchantName
  }

  return out
}

/**
 * Lookup-only shape returned by `readOrderGroupMandateIndex`. A future
 * PPP connector reads exactly these fields and then calls
 * `GET /_v/acg/mandates/:cartMandateId` to fetch the signed EvidenceBundle.
 */
export interface OrderMandateRef {
  cartMandateId: string
  didDocumentUrl?: string
  signedAt?: string
  signedBy?: string
  transactionId?: string
}

/**
 * Index the mandate ref by orderGroup so the PPP connector (which only
 * knows orderId/orderGroup) can recover it.
 */
export async function saveOrderGroupMandateIndex(
  vbase: VBaseClient,
  orderGroup: string,
  ref: OrderMandateRef
): Promise<void> {
  const fields: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(ref)) {
    if (v !== undefined) fields[k] = v
  }

  await vbase.saveJSON(ORDER_MANDATE_INDEX_BUCKET, orderGroup, fields)
}

/**
 * Read the mandate ref by orderGroup. Returns null when no entry exists
 * (e.g. for orders placed outside the ACG flow).
 */
export async function readOrderGroupMandateIndex(
  vbase: VBaseClient,
  orderGroup: string
): Promise<OrderMandateRef | null> {
  const fields = await vbase
    .getJSON<Record<string, unknown> | null>(
      ORDER_MANDATE_INDEX_BUCKET,
      orderGroup,
      true
    )
    .catch(() => null)

  if (!fields || typeof fields.cartMandateId !== 'string') return null

  const ref: OrderMandateRef = { cartMandateId: fields.cartMandateId }

  if (typeof fields.didDocumentUrl === 'string') {
    ref.didDocumentUrl = fields.didDocumentUrl
  }

  if (typeof fields.signedAt === 'string') ref.signedAt = fields.signedAt
  if (typeof fields.signedBy === 'string') ref.signedBy = fields.signedBy
  if (typeof fields.transactionId === 'string') {
    ref.transactionId = fields.transactionId
  }

  return ref
}

export interface MandateOrchestrationDeps {
  identity: MerchantIdentity
  vbase: VBaseClient
}

/**
 * Result of `verifyAgainstCart`: combines the structural mandate
 * verification with the drift-detection comparison.
 */
export interface MandateVsCartResult {
  verification: MandateVerification
  cartMatches: boolean
  reason?: string
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
    const cartData = simpleCartToCartData(cart)
    const cartMandate = await this.deps.identity.signCartMandate(cartData)
    const base = extractEvidenceBundle(cartMandate)
    const bundle: EvidenceBundle = { ...base, metadata }

    await this.deps.vbase.saveJSON<EvidenceBundle>(
      MANDATE_BUCKET,
      bundle.mandateId,
      bundle
    )

    return bundle
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
      )

      return bundle ?? null
    } catch {
      return null
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
    const bundle = await this.retrieve(mandateId)

    if (!bundle) {
      return {
        valid: false,
        checks: {
          signatureValid: false,
          notExpired: false,
          hashMatches: false,
        },
        error: 'mandate not found',
      }
    }

    const publicKey = await this.deps.identity.getPublicKey()

    return verifyCartMandate(bundle.cartMandate, publicKey)
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
    const bundle = await this.retrieve(mandateId)

    if (!bundle) {
      return {
        verification: {
          valid: false,
          checks: {
            signatureValid: false,
            notExpired: false,
            hashMatches: false,
          },
          error: 'mandate not found',
        },
        cartMatches: false,
        reason: 'mandate not found',
      }
    }

    const publicKey = await this.deps.identity.getPublicKey()
    const verification = await verifyCartMandate(bundle.cartMandate, publicKey)

    const cartData = simpleCartToCartData(currentCart)
    const cartMatches = mandateMatchesCart(bundle.cartMandate, cartData)

    let reason: string | undefined

    if (!cartMatches) {
      reason = describeDrift(bundle.cartMandate, cartData)
    }

    return { verification, cartMatches, reason }
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
  }
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
  const c = mandate.contents

  if (c.total.value !== cart.totalAmount.toFixed(2)) {
    return `total drifted: signed ${
      c.total.value
    }, current ${cart.totalAmount.toFixed(2)}`
  }

  if (c.total.currency !== cart.currency) {
    return `currency drifted: signed ${c.total.currency}, current ${cart.currency}`
  }

  if (c.order_reference !== cart.orderFormId) {
    return `orderFormId drifted: signed ${c.order_reference}, current ${cart.orderFormId}`
  }

  if (c.payment_items.length !== cart.items.length) {
    return `item count drifted: signed ${c.payment_items.length}, current ${cart.items.length}`
  }

  for (let i = 0; i < c.payment_items.length; i++) {
    const m = c.payment_items[i]
    const x = cart.items[i]

    if (m.sku !== x.sku) {
      return `item ${i} SKU drifted: signed ${m.sku}, current ${x.sku}`
    }

    if (m.quantity !== x.quantity) {
      return `item ${i} (sku ${x.sku}) quantity drifted: signed ${m.quantity}, current ${x.quantity}`
    }

    const expected = (x.unitPrice * x.quantity).toFixed(2)

    if (m.amount.value !== expected) {
      return `item ${i} (sku ${x.sku}) price drifted: signed ${m.amount.value}, current ${expected}`
    }
  }

  return 'unknown drift'
}
