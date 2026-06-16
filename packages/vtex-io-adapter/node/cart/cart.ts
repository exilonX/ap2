/**
 * Cart module — Cart Negotiation made concrete.
 *
 * Hides VTEX `orderForm` shape behind a domain interface. Owns the
 * cross-cutting protections that previously lived (unevenly) across
 * the REST handler and the chat-tool executor:
 *
 *   - Fabricated-SKU rejection
 *   - ORD003 transient retry (350 ms backoff, single retry)
 *   - Actually-added check (qty before/after)
 *   - Item-index lookup by SKU (private helper)
 *   - Coupon-actually-applied check
 *   - OrderForm substitution detection
 *   - Logistics-info construction (private helper)
 *
 * Returns `SimpleCart` for the standard ops; richer return for
 * `applyCoupon`; typed errors from `./errors` for hard failures.
 *
 * Cart is **not** registered in the IOClients pattern — IOClients is
 * reserved for HTTP/external clients. Cart is a domain module that
 * *uses* an HTTP client.
 */

import type {
  CheckoutClient,
  ClientProfileData,
  PaymentSystem,
  VTEXOrderForm,
} from '../clients/checkout'
import { mapOrderFormToCart } from '../mappers/cart'
import type { SimpleCart } from '../types/shared'
import {
  InvalidSkuFormatError,
  ItemNotAddedError,
  ItemNotInCartError,
  OrderFormSubstitutedError,
  TransientCartError,
} from './errors'

export interface Logger {
  warn?: (msg: string, ...rest: unknown[]) => void
  info?: (msg: string, ...rest: unknown[]) => void
}

export interface CartDeps {
  checkout: CheckoutClient
  log?: Logger
}

/**
 * Profile fields accepted by Cart.setCustomerProfile.
 *
 * Subset of VTEX's ClientProfileData — B2B fields are deferred. Cart
 * always sends `isCorporate: false` to VTEX.
 */
export interface CustomerProfileInput {
  email: string
  firstName: string
  lastName: string
  /**
   * Country-local phone format. For VTEX Europe (RO) this is the
   * 10-digit leading-zero local form (e.g. "0700000000"); E.164 with the
   * "+40" prefix is accepted with HTTP 200 but VTEX persists `phone: null`
   * silently, causing the field to render blank in the admin. The
   * `Cart.setCustomerProfile` boundary normalizes "+40…" → "0…" so any
   * caller (chat tools, MCP, future surfaces) is safe.
   */
  phone?: string
  document?: string
  /**
   * Defaults to "document" (VTEX's generic EU value) when omitted.
   * Brazilian "cpf" is silently rejected on VTEX EU and persisted as
   * null.
   */
  documentType?: string
}

/**
 * Address fields accepted by Cart.setShippingAddress.
 */
export interface ShippingAddressInput {
  postalCode: string
  city: string
  state: string
  street: string
  number: string
  /**
   * Optional — VTEX EU stores `null` when omitted, matching the
   * reference order on Bucharest/RO addresses without a neighborhood.
   * Older callers that hardcoded `neighborhood: ''` should drop the
   * empty default; the request body now omits the field entirely.
   */
  neighborhood?: string
  country?: string
  complement?: string
  reference?: string
  receiverName?: string
  addressType?: string
}

/**
 * Single shipping option, the shape Cart.getShippingOptions returns.
 *
 * Different from SimpleCart on purpose — these are choice candidates,
 * not cart state.
 */
export interface ShippingOption {
  id: string
  name: string
  price: number // already in major currency units (e.g. RON), VTEX returns cents
  estimatedDelivery: string
}

/**
 * Normalized shape Cart.getAvailablePaymentSystems returns.
 *
 * Strips the noisy fields VTEX returns on `paymentData.paymentSystems[]`
 * (templates, validators, dueDates) down to what an agent needs to pick
 * a method: an id to pass to setPaymentData, a name for the LLM to
 * surface to the user, and the payment group VTEX expects on the
 * paymentData write.
 */
export interface PaymentMethodOption {
  id: string
  name: string
  group: string
  requiresAuthentication: boolean
}

/**
 * Args for Cart.setPaymentData.
 *
 * `value` defaults to the current cart total (in cents) — callers
 * usually want to pay for the whole cart with one method. Pass an
 * explicit value to split payments across multiple methods.
 *
 * `installments` defaults to 1 (single-shot, no interest).
 */
export interface SetPaymentDataInput {
  paymentSystemId: string
  paymentSystemName?: string
  group?: string
  installments?: number
  value?: number // in cents; defaults to orderForm.value
}

/**
 * Return shape for Cart.applyCoupon.
 *
 * The non-uniform return is intentional: coupon non-application is a
 * known soft outcome (e.g. "no eligible items"), not an error — the
 * caller needs to know.
 */
export interface ApplyCouponResult {
  cart: SimpleCart
  applied: boolean
  reason?: string
}

const TRANSIENT_BACKOFF_MS = 500
// Patterns that indicate a transient VTEX-side hiccup worth retrying once.
//  - ORD003 / rates and benefits — VTEX's eventual-consistency message
//  - 5xx HTTP — generic server error from upstream VTEX services
//  - Connection refused / ECONNREFUSED / ETIMEDOUT / ECONNRESET —
//    internal VTEX service-to-service routing flap (e.g. an internal
//    10.x IP refusing connections during a service restart)
const TRANSIENT_ERROR_PATTERN = /ORD003|rates and benefits|\b5\d\d\b|Connection refused|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i

export class Cart {
  constructor(private deps: CartDeps) {}

  /**
   * Get the current cart.
   *
   * Pass-through to checkout.getOrderForm + mapOrderFormToCart, with
   * an orderForm-substitution guard.
   */
  public async getCart(orderFormId: string): Promise<SimpleCart> {
    const orderForm = await this.deps.checkout.getOrderForm(orderFormId)

    this.assertSameCart(orderFormId, orderForm)

    return mapOrderFormToCart(orderForm)
  }

  /**
   * Add an item to the cart.
   *
   * Cross-cutting protections:
   *  - Throws InvalidSkuFormatError if `sku` doesn't match `^\d+$`
   *    (catches LLM-fabricated SKUs like `588600_M`).
   *  - Snapshots qty-before; if qty-after didn't grow, throws
   *    ItemNotAddedError (catches VTEX's silent-success on unknown SKUs).
   *  - Single retry on ORD003 with 350 ms back-off; if it persists,
   *    throws TransientCartError('ORD003').
   *  - Verifies returned orderForm id matches.
   */
  public async addItem(
    orderFormId: string,
    sku: string,
    qty: number
  ): Promise<SimpleCart> {
    if (!/^\d+$/.test(sku)) {
      throw new InvalidSkuFormatError(sku)
    }

    // Snapshot qty-before. If the fetch fails, treat it as 0 — the
    // actually-added check below still catches no-ops (qtyAfter would
    // need to be > 0 to pass).
    const before = await this.deps.checkout
      .getOrderForm(orderFormId)
      .catch(() => null)

    if (before) {
      this.assertSameCart(orderFormId, before)
    }

    const qtyBefore = before?.items?.find((i) => i.id === sku)?.quantity ?? 0

    const tryAdd = (): Promise<VTEXOrderForm> =>
      this.deps.checkout.addItems(orderFormId, [
        { id: sku, quantity: qty, seller: '1' },
      ])

    let orderForm: VTEXOrderForm

    try {
      orderForm = await tryAdd()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      if (TRANSIENT_ERROR_PATTERN.test(msg)) {
        this.deps.log?.warn?.(
          `[Cart] transient VTEX error for SKU ${sku}, retrying after ${TRANSIENT_BACKOFF_MS}ms: ${msg}`
        )
        await new Promise((r) => setTimeout(r, TRANSIENT_BACKOFF_MS))
        try {
          orderForm = await tryAdd()
        } catch (retryErr) {
          const retryMsg =
            retryErr instanceof Error ? retryErr.message : String(retryErr)

          // Tag the code based on which pattern matched the original error
          // so callers / metrics can distinguish ORD003 from infra-level
          // flakes. Defaults to 'TRANSIENT' for the generic 5xx case.
          const code = /ORD003|rates and benefits/i.test(msg)
            ? 'ORD003'
            : 'TRANSIENT'

          this.deps.log?.warn?.(
            `[Cart] transient VTEX error persisted after retry for SKU ${sku}: ${retryMsg}`
          )
          throw new TransientCartError(code)
        }
      } else {
        throw err
      }
    }

    this.assertSameCart(orderFormId, orderForm)

    const cart = mapOrderFormToCart(orderForm)
    const added = cart.items.find((i) => i.sku === sku)
    const qtyAfter = added?.quantity ?? 0

    if (!added || qtyAfter <= qtyBefore) {
      this.deps.log?.warn?.(
        `[Cart] add no-op for SKU ${sku} (qty before/after: ${qtyBefore}/${qtyAfter})`
      )
      throw new ItemNotAddedError(sku)
    }

    return cart
  }

  /**
   * Remove an item by SKU.
   *
   * Throws ItemNotInCartError if the SKU isn't in the cart.
   */
  public async removeBySku(
    orderFormId: string,
    sku: string
  ): Promise<SimpleCart> {
    const orderForm = await this.deps.checkout.getOrderForm(orderFormId)

    this.assertSameCart(orderFormId, orderForm)

    const index = this.findItemIndexBySku(orderForm, sku)
    const updated = await this.deps.checkout.removeItem(orderFormId, index)

    this.assertSameCart(orderFormId, updated)

    return mapOrderFormToCart(updated)
  }

  /**
   * Set the quantity of an item by SKU.
   *
   * Throws InvalidSkuFormatError if the SKU is malformed.
   * Throws ItemNotInCartError if the SKU isn't in the cart.
   *
   * If `qty === 0` this acts as a remove (matches VTEX's native semantics —
   * `updateItems` with quantity 0 deletes the row).
   */
  public async setQuantity(
    orderFormId: string,
    sku: string,
    qty: number
  ): Promise<SimpleCart> {
    if (!/^\d+$/.test(sku)) {
      throw new InvalidSkuFormatError(sku)
    }

    const orderForm = await this.deps.checkout.getOrderForm(orderFormId)

    this.assertSameCart(orderFormId, orderForm)

    const index = this.findItemIndexBySku(orderForm, sku)
    const updated = await this.deps.checkout.updateItems(orderFormId, [
      { index, quantity: qty },
    ])

    this.assertSameCart(orderFormId, updated)

    return mapOrderFormToCart(updated)
  }

  /**
   * Apply a coupon code.
   *
   * Returns `{ cart, applied, reason? }` — coupon non-application is a
   * soft outcome, not an error. `applied` is true when the discount
   * delta is positive after the call.
   */
  public async applyCoupon(
    orderFormId: string,
    code: string
  ): Promise<ApplyCouponResult> {
    const before = await this.deps.checkout.getOrderForm(orderFormId)

    this.assertSameCart(orderFormId, before)
    const discountBefore = this.discountValue(before)
    const itemCountBefore = before.items.length

    const after = await this.deps.checkout.addCoupon(orderFormId, code)

    this.assertSameCart(orderFormId, after)

    const cart = mapOrderFormToCart(after)
    const discountAfter = this.discountValue(after)
    const delta = discountAfter - discountBefore

    if (delta > 0) {
      return { cart, applied: true }
    }

    // Try to surface a useful reason. VTEX sometimes embeds coupon-status
    // info on the orderForm (`messages` or `marketingData`). We're
    // conservative — we only label "no eligible items" when item counts
    // didn't change and no discount appeared.
    let reason: string

    if (after.items.length === itemCountBefore) {
      reason = 'no eligible items'
    } else {
      reason = 'coupon not applied by VTEX'
    }

    return { cart, applied: false, reason }
  }

  /**
   * Set the customer profile on the cart.
   *
   * B2B fields (corporateName, etc.) are deferred — Cart always sends
   * `isCorporate: false`.
   */
  public async setCustomerProfile(
    orderFormId: string,
    data: CustomerProfileInput
  ): Promise<SimpleCart> {
    // VTEX RO accepts E.164 numbers ("+40…") with HTTP 200 but persists
    // phone:null silently, leaving the field blank in admin. Rewrite the
    // common "+40 → 0" prefix here at the Cart boundary so every caller
    // path (chat, MCP, future surfaces) is protected uniformly.
    const normalizedPhone = data.phone?.startsWith('+40')
      ? `0${data.phone.slice(3).replace(/\D/g, '')}`
      : data.phone

    // "cpf" is Brazilian and silently rejected on VTEX EU. Default to
    // "document" (the generic value the reference RO order uses) when
    // the caller omits documentType.
    const documentType = data.documentType ?? 'document'

    const payload: ClientProfileData = {
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: normalizedPhone,
      document: data.document,
      documentType,
      isCorporate: false,
    }

    const updated = await this.deps.checkout.addClientProfileData(
      orderFormId,
      payload
    )

    this.assertSameCart(orderFormId, updated)

    return mapOrderFormToCart(updated)
  }

  /**
   * Set the shipping address on the cart.
   *
   * Builds the per-item logisticsInfo from the current orderForm so
   * callers don't have to know about the
   * `{ itemIndex, selectedSla: 'Normal', selectedDeliveryChannel: 'delivery' }`
   * shape.
   */
  public async setShippingAddress(
    orderFormId: string,
    data: ShippingAddressInput
  ): Promise<SimpleCart> {
    const orderForm = await this.deps.checkout.getOrderForm(orderFormId)

    this.assertSameCart(orderFormId, orderForm)

    const logisticsInfo = this.buildLogisticsInfo(orderForm)

    // When the caller omits receiverName, derive it from the cart's
    // existing clientProfileData (set on a prior turn). Leaves empty
    // string as the last-resort fallback so this path stays non-throwing
    // even when the LLM sets shipping before profile.
    const profile = orderForm.clientProfileData as
      | { firstName?: string; lastName?: string }
      | null
      | undefined

    const derivedName =
      profile && (profile.firstName || profile.lastName)
        ? [profile.firstName, profile.lastName].filter(Boolean).join(' ')
        : ''

    const receiverName = data.receiverName ?? derivedName

    const updated = await this.deps.checkout.addShippingData(orderFormId, {
      clearAddressIfPostalCodeNotFound: false,
      selectedAddresses: [
        {
          addressType: data.addressType ?? 'residential',
          receiverName,
          postalCode: data.postalCode,
          city: data.city,
          state: data.state,
          country: data.country ?? 'ROU',
          street: data.street,
          number: data.number,
          // Omit neighborhood entirely when undefined so VTEX persists
          // `null` (matches reference RO orders) instead of "".
          ...(data.neighborhood !== undefined
            ? { neighborhood: data.neighborhood }
            : {}),
          complement: data.complement,
          reference: data.reference,
        },
      ],
      logisticsInfo,
    })

    this.assertSameCart(orderFormId, updated)

    return mapOrderFormToCart(updated)
  }

  /**
   * Get available shipping options for the cart.
   *
   * Returns a list of `ShippingOption` (different shape from `SimpleCart` —
   * these are choice candidates, not cart state).
   *
   * **Side effect**: this calls VTEX's `simulateOrderForm`, which
   * recomputes shipping totals on the orderForm. The next `getCart` will
   * reflect any totals changes. This is a quirk of the underlying VTEX
   * API; we don't try to "fix" it.
   */
  public async getShippingOptions(
    orderFormId: string
  ): Promise<ShippingOption[]> {
    const orderForm = await this.deps.checkout.simulateOrderForm(orderFormId)

    this.assertSameCart(orderFormId, orderForm)

    const logisticsInfo = orderForm.shippingData?.logisticsInfo as
      | Array<{
          slas?: Array<{
            id: string
            name: string
            price: number
            shippingEstimate: string
          }>
        }>
      | undefined

    const slas = logisticsInfo?.[0]?.slas ?? []

    return slas.map((sla) => ({
      id: sla.id,
      name: sla.name,
      price: sla.price / 100,
      estimatedDelivery: sla.shippingEstimate,
    }))
  }

  /**
   * Get the payment methods the merchant has configured for this cart's
   * sales channel.
   *
   * Reads `orderForm.paymentData.paymentSystems[]` and normalizes each
   * entry into a `PaymentMethodOption`. Filters out entries with no
   * `groupName` (defensive — observed in stale catalog configs).
   *
   * The returned `id` is `stringId` if VTEX provided one, else `String(id)`.
   * Use that id verbatim when calling `setPaymentData` — VTEX accepts
   * either string or numeric form and the string is safer for ids that
   * exceed JS's safe integer range.
   */
  public async getAvailablePaymentSystems(
    orderFormId: string
  ): Promise<PaymentMethodOption[]> {
    const orderForm = await this.deps.checkout.getOrderForm(orderFormId)

    this.assertSameCart(orderFormId, orderForm)

    const systems: PaymentSystem[] = orderForm.paymentData?.paymentSystems ?? []

    return systems
      .filter((s) => Boolean(s.groupName))
      .map((s) => ({
        id: s.stringId ?? String(s.id),
        name: s.name,
        group: s.groupName,
        requiresAuthentication: Boolean(s.requiresAuthentication),
      }))
  }

  /**
   * Set the payment method on the cart.
   *
   * Wraps `CheckoutClient.addPaymentData` with the minimal payload that
   * matches the headless-checkout Postman flow. Resolves the cart total
   * automatically when `value` is omitted (the common case — pay the
   * whole cart with one method).
   *
   * If `paymentSystemName` / `group` aren't provided, looks them up
   * against the merchant's configured payment systems. That second
   * round-trip is the price of letting the LLM pass just the id; callers
   * that already know the system (e.g. profile-driven defaults) can
   * pass all three fields to skip it.
   */
  public async setPaymentData(
    orderFormId: string,
    input: SetPaymentDataInput
  ): Promise<SimpleCart> {
    const current = await this.deps.checkout.getOrderForm(orderFormId)

    this.assertSameCart(orderFormId, current)

    let { paymentSystemName } = input
    let { group } = input

    if (!paymentSystemName || !group) {
      const systems = current.paymentData?.paymentSystems ?? []
      const match = systems.find(
        (s) => (s.stringId ?? String(s.id)) === input.paymentSystemId
      )

      if (!match) {
        throw new Error(
          `Cart.setPaymentData: paymentSystem ${input.paymentSystemId} is not configured on this orderForm. Call getAvailablePaymentSystems to see the merchant's configured methods.`
        )
      }

      paymentSystemName = paymentSystemName ?? match.name
      group = group ?? match.groupName
    }

    const value = input.value ?? current.value
    const installments = input.installments ?? 1

    // Pull buyer identity from clientProfileData so VTEX surfaces the
    // name + document badges on the PCI Gateway transaction widget
    // ("Ionel Merca" + "document" in reference orders; without these
    // the widget renders "Fără denumire"/No name).
    const profile = current.clientProfileData as
      | {
          firstName?: string
          lastName?: string
          document?: string | null
          documentType?: string | null
        }
      | null
      | undefined

    const buyerIdentity: {
      firstName?: string
      lastName?: string
      document?: string
      documentType?: string
    } = {}

    if (profile?.firstName) buyerIdentity.firstName = profile.firstName
    if (profile?.lastName) buyerIdentity.lastName = profile.lastName
    if (profile?.document) buyerIdentity.document = profile.document
    if (profile?.documentType) buyerIdentity.documentType = profile.documentType

    const updated = await this.deps.checkout.addPaymentData(orderFormId, {
      payments: [
        {
          paymentSystem: input.paymentSystemId,
          paymentSystemName,
          group,
          value,
          installments,
          installmentsInterestRate: 0,
          referenceValue: value,
          hasDefaultBillingAddress: false,
          ...buyerIdentity,
        },
      ],
    })

    this.assertSameCart(orderFormId, updated)

    return mapOrderFormToCart(updated)
  }

  /**
   * Create a new (empty) cart.
   *
   * Returns a `SimpleCart` (not just an id) so the return shape is
   * uniform with the other ops.
   */
  public async createCart(): Promise<SimpleCart> {
    const orderForm = await this.deps.checkout.createOrderForm()

    return mapOrderFormToCart(orderForm)
  }

  // ─── Private helpers ───────────────────────────────────────────────

  /**
   * Throws OrderFormSubstitutedError if VTEX silently swapped the
   * orderFormId between request and response.
   */
  private assertSameCart(requested: string, returned: VTEXOrderForm): void {
    if (returned.orderFormId !== requested) {
      throw new OrderFormSubstitutedError(requested, returned.orderFormId)
    }
  }

  /**
   * Find the index of an item by SKU, or throw ItemNotInCartError.
   */
  private findItemIndexBySku(orderForm: VTEXOrderForm, sku: string): number {
    const index = orderForm.items.findIndex((i) => i.id === sku)

    if (index === -1) {
      throw new ItemNotInCartError(sku)
    }

    return index
  }

  /**
   * Build per-item logisticsInfo for `addShippingData`.
   *
   * Hides the
   * `{ itemIndex, selectedSla: 'Normal', selectedDeliveryChannel: 'delivery' }`
   * shape from callers.
   */
  private buildLogisticsInfo(orderForm: VTEXOrderForm) {
    return orderForm.items.map((_, index) => ({
      itemIndex: index,
      selectedSla: 'Normal',
      selectedDeliveryChannel: 'delivery',
    }))
  }

  /**
   * Pull the current discount value (in cents, positive) from an
   * orderForm's totalizers.
   */
  private discountValue(orderForm: VTEXOrderForm): number {
    const t = orderForm.totalizers?.find((x) => x.id === 'Discounts')

    return t ? Math.abs(t.value) : 0
  }
}

// Re-export typed errors so callers can import them from one place.
export {
  InvalidSkuFormatError,
  ItemNotAddedError,
  ItemNotInCartError,
  TransientCartError,
  OrderFormSubstitutedError,
} from './errors'
