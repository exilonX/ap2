/**
 * Checkout Client
 *
 * Wraps VTEX Checkout API (orderForm operations).
 * Implements the headless checkout flow as per VTEX API documentation.
 */

import type { InstanceOptions, IOContext } from '@vtex/api'
import { ExternalClient } from '@vtex/api'

export interface VTEXOrderForm {
  orderFormId: string
  salesChannel: string
  loggedIn: boolean
  isCheckedIn: boolean
  storeId: string | null
  checkedInPickupPointId: string | null
  allowManualPrice: boolean
  canEditData: boolean
  userProfileId: string | null
  userType: string | null
  ignoreProfileData: boolean
  value: number
  messages: unknown[]
  items: VTEXOrderFormItem[]
  selectableGifts: unknown[]
  totalizers: Array<{
    id: string
    name: string
    value: number
  }>
  shippingData: {
    address: unknown | null
    logisticsInfo: unknown[]
    selectedAddresses: unknown[]
    availableAddresses: unknown[]
    pickupPoints: unknown[]
  }
  clientProfileData: {
    email: string | null
    firstName: string | null
    lastName: string | null
    document: string | null
    documentType: string | null
    phone: string | null
    corporateName: string | null
    tradeName: string | null
    corporateDocument: string | null
    stateInscription: string | null
    corporatePhone: string | null
    isCorporate: boolean
    profileCompleteOnLoading: boolean | null
    profileErrorOnLoading: boolean | null
    customerClass: string | null
  } | null
  paymentData: {
    updateStatus: string
    installmentOptions: unknown[]
    paymentSystems: PaymentSystem[]
    payments: unknown[]
    giftCards: unknown[]
    giftCardMessages: unknown[]
    availableAccounts: unknown[]
    availableTokens: unknown[]
  }
  marketingData: unknown | null
  sellers: Array<{
    id: string
    name: string
    logo: string
  }>
  clientPreferencesData: unknown | null
  commercialConditionData: unknown | null
  storePreferencesData: {
    countryCode: string
    saveUserData: boolean
    timeZone: string
    currencyCode: string
    currencyLocale: number
    currencySymbol: string
    currencyFormatInfo: unknown
  }
  giftRegistryData: unknown | null
  openTextField: unknown | null
  invoiceData: unknown | null
  customData: unknown | null
  itemMetadata: unknown | null
  hooksData: unknown | null
  ratesAndBenefitsData: unknown | null
  subscriptionData: unknown | null
  merchantContextData: unknown | null
  itemsOrdination: unknown | null
}

export interface VTEXOrderFormItem {
  uniqueId: string
  id: string
  productId: string
  productRefId: string
  refId: string
  ean: string | null
  name: string
  skuName: string
  modalType: string | null
  parentItemIndex: number | null
  parentAssemblyBinding: string | null
  assemblies: unknown[]
  priceValidUntil: string
  tax: number
  price: number
  listPrice: number
  manualPrice: number | null
  manualPriceAppliedBy: string | null
  sellingPrice: number
  rewardValue: number
  isGift: boolean
  additionalInfo: {
    dimension: unknown | null
    brandName: string
    brandId: string
    offeringInfo: unknown | null
    offeringType: unknown | null
    offeringTypeId: unknown | null
  }
  preSaleDate: string | null
  productCategoryIds: string
  productCategories: Record<string, string>
  quantity: number
  seller: string
  sellerChain: string[]
  imageUrl: string
  detailUrl: string
  components: unknown[]
  bundleItems: unknown[]
  attachments: unknown[]
  attachmentOfferings: unknown[]
  offerings: unknown[]
  priceTags: unknown[]
  availability: string
  measurementUnit: string
  unitMultiplier: number
  manufacturerCode: string | null
  priceDefinition: unknown | null
}

export class CheckoutClient extends ExternalClient {
  constructor(context: IOContext, options?: InstanceOptions) {
    super(`http://${context.account}.vtexcommercestable.com.br`, context, {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Vtex-Use-Https': 'true',
      },
    })
  }

  /**
   * Create a new orderForm (cart)
   */
  public async createOrderForm(): Promise<VTEXOrderForm> {
    return this.http.post<VTEXOrderForm>(
      '/api/checkout/pub/orderForm',
      {},
      { metric: 'acg-create-orderform' }
    )
  }

  /**
   * Get existing orderForm
   */
  public async getOrderForm(orderFormId: string): Promise<VTEXOrderForm> {
    return this.http.get<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}`,
      { metric: 'acg-get-orderform' }
    )
  }

  /**
   * Add items to orderForm
   */
  public async addItems(
    orderFormId: string,
    items: Array<{ id: string; quantity: number; seller: string }>
  ): Promise<VTEXOrderForm> {
    return this.http.post<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}/items`,
      {
        orderItems: items,
      },
      { metric: 'acg-add-items' }
    )
  }

  /**
   * Update item quantity
   */
  public async updateItems(
    orderFormId: string,
    items: Array<{ index: number; quantity: number }>
  ): Promise<VTEXOrderForm> {
    return this.http.post<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}/items/update`,
      {
        orderItems: items,
      },
      { metric: 'acg-update-items' }
    )
  }

  /**
   * Remove item (set quantity to 0)
   */
  public async removeItem(
    orderFormId: string,
    itemIndex: number
  ): Promise<VTEXOrderForm> {
    return this.updateItems(orderFormId, [{ index: itemIndex, quantity: 0 }])
  }

  /**
   * Simulate orderForm to get updated prices/shipping
   * This is useful before creating a mandate
   */
  public async simulateOrderForm(orderFormId: string): Promise<VTEXOrderForm> {
    return this.http.get<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}`,
      { metric: 'acg-simulate' }
    )
  }

  /**
   * Add coupon/promo code to orderForm
   */
  public async addCoupon(
    orderFormId: string,
    couponCode: string
  ): Promise<VTEXOrderForm> {
    return this.http.post<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}/coupons`,
      { text: couponCode },
      { metric: 'acg-add-coupon' }
    )
  }

  /**
   * Add client profile data (customer information)
   * Step 3 in headless checkout flow
   */
  public async addClientProfileData(
    orderFormId: string,
    data: ClientProfileData
  ): Promise<VTEXOrderForm> {
    return this.http.post<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}/attachments/clientProfileData`,
      data,
      { metric: 'acg-client-profile' }
    )
  }

  /**
   * Add shipping data (address and logistics)
   * Step 4 in headless checkout flow
   */
  public async addShippingData(
    orderFormId: string,
    data: ShippingData
  ): Promise<VTEXOrderForm> {
    return this.http.post<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}/attachments/shippingData`,
      data,
      { metric: 'acg-shipping-data' }
    )
  }

  /**
   * Add payment data
   * Step 5 in headless checkout flow
   */
  public async addPaymentData(
    orderFormId: string,
    data: PaymentData
  ): Promise<VTEXOrderForm> {
    return this.http.post<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}/attachments/paymentData`,
      data,
      { metric: 'acg-payment-data' }
    )
  }

  /**
   * Place order (create transaction).
   *
   * Step 6 in headless checkout flow. POSTs the orderForm to VTEX
   * Checkout's `/transaction` endpoint, which commits the cart into a
   * real OMS order and returns the orderGroup + merchantTransactions.
   *
   * The body MUST include `value` and `referenceValue` matching the
   * current `orderForm.value`. Omitting them causes VTEX to default
   * the comparison value to 0 internally, which then fails the
   * "payment value differs from order value" check (ORD009) regardless
   * of how the orderForm's own paymentData is set up. This is not in
   * VTEX's swagger but the Postman collection and the headless
   * checkout reference implementations all send these fields.
   *
   * `interestValue` is the interest portion of the total — 0 for
   * non-credit-card payments like Cash, promissory, or 1-installment
   * card flows.
   */
  public async placeOrder(
    orderFormId: string,
    input: {
      referenceId: string
      value: number
      referenceValue?: number
      interestValue?: number
      savePersonalData?: boolean
      optinNewsLetter?: boolean
    }
  ): Promise<PlaceOrderResponse> {
    return this.http.post<PlaceOrderResponse>(
      `/api/checkout/pub/orderForm/${orderFormId}/transaction`,
      {
        referenceId: input.referenceId,
        savePersonalData: input.savePersonalData ?? false,
        optinNewsLetter: input.optinNewsLetter ?? false,
        value: input.value,
        referenceValue: input.referenceValue ?? input.value,
        interestValue: input.interestValue ?? 0,
      },
      { metric: 'acg-place-order' }
    )
  }

  /**
   * Write a structured customData record onto the orderForm.
   *
   * VTEX exposes one customData namespace per "appId" — e.g. the future
   * AP2 PPP connector will read its inputs from `appId='ap2'`. Each PUT
   * replaces the namespace's fields wholesale (it is not a merge).
   *
   * Used today to persist the AP2 mandateId (and the in-flight
   * transactionId, once `place_order` returns) so subsequent agent tools
   * can rediscover them without a server-side conversation store.
   */
  public async setCustomData(
    orderFormId: string,
    appId: string,
    fields: Record<string, unknown>
  ): Promise<VTEXOrderForm> {
    return this.http.put<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}/customData/${appId}`,
      fields,
      { metric: 'acg-set-custom-data' }
    )
  }

  /**
   * Process the order — Step 3 of VTEX's official 3-step order placement
   * flow (place → pay → process). Without this call the transaction stays
   * in "Authorizing" forever and VTEX cancels the order after the 5-minute
   * window.
   *
   * Returns 204 No Content on success. Public endpoint, takes the standard
   * VTEX IO proxy-authorization — no AppKey/AppToken required.
   *
   * Reference: https://developers.vtex.com/docs/guides/creating-a-regular-order-from-an-existing-cart
   */
  public async processOrder(orderGroup: string): Promise<void> {
    await this.http.post(
      `/api/checkout/pub/gatewayCallback/${orderGroup}`,
      {},
      { metric: 'acg-process-order' }
    )
  }

  /**
   * Get order details by order ID
   */
  public async getOrder(orderId: string): Promise<any> {
    return this.http.get(`/api/oms/pvt/orders/${orderId}`, {
      metric: 'acg-get-order',
    })
  }
}

/**
 * Payments Client
 *
 * Handles payment gateway operations (vtexpayments.com.br)
 */
export class PaymentsClient extends ExternalClient {
  constructor(context: IOContext, options?: InstanceOptions) {
    super(`https://${context.account}.vtexpayments.com.br`, context, {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
  }

  /**
   * Send payment information
   * Step 7 in headless checkout flow
   */
  public async sendPayments(
    transactionId: string,
    orderId: string,
    payments: PaymentRequest[]
  ): Promise<unknown> {
    // VTEX expects a BARE ARRAY of payments (not `{payments: [...]}`)
    // and the `orderId` (= orderGroup) MUST be in the query string —
    // otherwise the gateway can't link the payment to the order and
    // returns a NullReferenceException.
    return this.http.post(
      `/api/pub/transactions/${transactionId}/payments?orderId=${encodeURIComponent(
        orderId
      )}`,
      payments,
      { metric: 'acg-send-payments' }
    )
  }

  /**
   * Authorize payment / Start transaction
   * Step 8 (final) in headless checkout flow
   */
  public async authorizeTransaction(
    transactionId: string,
    orderId: string,
    options?: {
      callbackUrl?: string
      credentials?: { appKey: string; appToken: string }
    }
  ): Promise<AuthorizationResponse> {
    // The `/pvt/` endpoint rejects VTEX IO's internal proxy-authorization
    // token with 401. When the caller supplies merchant credentials
    // (configured in app settings), forward them as the documented
    // X-VTEX-API-AppKey / X-VTEX-API-AppToken pair so the gateway
    // authorizes the call. Without credentials, the call still fires
    // and the 401 soft-success fallback in agent-tools/authorize-
    // transaction.ts handles it for Cash/promissory flows.
    const requestOptions = options?.credentials
      ? {
          metric: 'acg-authorize-payment',
          headers: {
            'X-VTEX-API-AppKey': options.credentials.appKey,
            'X-VTEX-API-AppToken': options.credentials.appToken,
          },
        }
      : { metric: 'acg-authorize-payment' }

    return this.http.post<AuthorizationResponse>(
      `/api/pvt/transactions/${transactionId}/authorization-request`,
      {
        transactionId,
        softDescriptor: 'ACG Purchase',
        prepareForRecurrency: false,
        split: [],
        callbackUrl: options?.callbackUrl ?? '',
        orderId,
      },
      requestOptions
    )
  }
}

// Type definitions for checkout flow

export interface ClientProfileData {
  email: string
  firstName: string
  lastName: string
  documentType?: string
  document?: string
  phone?: string
  corporateName?: string | null
  tradeName?: string | null
  corporateDocument?: string | null
  stateInscription?: string | null
  corporatePhone?: string | null
  isCorporate?: boolean
}

export interface ShippingAddress {
  addressType: string
  receiverName: string
  addressId?: string
  isDisposable?: boolean
  postalCode: string
  city: string
  state: string
  country: string
  street: string
  number: string
  /**
   * Optional — VTEX EU persists `null` when the field is omitted from
   * the outbound request body, which matches the reference RO order.
   */
  neighborhood?: string
  complement?: string
  reference?: string
  geoCoordinates?: [number, number]
}

export interface LogisticsInfo {
  itemIndex: number
  selectedSla: string
  selectedDeliveryChannel?: string
  addressId?: string
  price?: number
}

export interface ShippingData {
  clearAddressIfPostalCodeNotFound?: boolean
  selectedAddresses: ShippingAddress[]
  logisticsInfo: LogisticsInfo[]
}

/**
 * One entry in `orderForm.paymentData.paymentSystems[]` — the merchant's
 * configured payment methods for the current cart's sales channel.
 *
 * Surfaced via `Cart.getAvailablePaymentSystems` so the agent can offer
 * the user the methods this merchant actually accepts (Cash, card,
 * full-redirect, etc.) rather than guessing.
 */
export interface PaymentSystem {
  id: number
  name: string
  groupName: string
  stringId?: string
  validator?: unknown
  template?: unknown
  requiresDocument?: boolean
  selected?: boolean
  isCustom?: boolean
  description?: string | null
  requiresAuthentication?: boolean
  dueDate?: string
  availablePayments?: unknown
}

/**
 * Payload accepted by `addPaymentData`.
 *
 * Note: VTEX accepts BOTH `paymentSystem: number` and `paymentSystem: string`
 * on the wire. We use string here because the orderForm reports `stringId`
 * and several real merchant configurations carry numeric ids that exceed
 * what `number` should hold for an id.
 *
 * `paymentSystemName`, `group`, `installmentsInterestRate`,
 * `hasDefaultBillingAddress` are present in the live Postman flow for
 * miniprix / OBI — included as optional so the connector-less Cash path
 * works while not blocking the future card / redirect paths.
 */
export interface PaymentData {
  payments: Array<{
    paymentSystem: number | string
    paymentSystemName?: string
    group?: string
    installments: number
    installmentsInterestRate?: number
    referenceValue?: number
    value: number
    currencyCode?: string
    hasDefaultBillingAddress?: boolean
    // Buyer-identity fields surfaced on PCI Gateway transaction widget
    // ("Ionel Merca" + "document" badges next to amount). Set from
    // clientProfileData when available; VTEX otherwise displays
    // "Fără denumire" (No name) on cash/promissory orders.
    firstName?: string
    lastName?: string
    document?: string
    documentType?: string
  }>
}

/**
 * Real shape of `POST /api/checkout/pub/orderForm/:id/transaction`'s response.
 *
 * VTEX's transaction-creation response is FLAT — the previous nested
 * shape with `transactionData.merchantTransactions[]` exists only on
 * `GET /api/checkout/pub/orderForm/:id`, not on the POST. Here:
 *
 *   - `id` at top level IS the transactionId (matches
 *     `merchantTransactions[0].transactionId`).
 *   - `merchantTransactions[]` is at top level (no `transactionData`
 *     wrapper) — one entry per merchant/seller split.
 *   - `receiverUri` is the authoritative URL for the next call
 *     (`POST /api/pub/transactions/:tid/payments?orderId=:og`).
 *   - `orderGroup` at top level is the OMS group identifier.
 *   - `messages[]` — on a rejected transaction VTEX returns 200 with
 *     this populated (e.g. ORD009).
 *
 * The legacy `orders[]` / nested `transactionData` fields are kept as
 * optionals so older test fakes keep type-checking, but production code
 * should read from the flat top-level fields.
 */
export interface PlaceOrderResponse {
  orderGroup: string
  id?: string
  merchantTransactions?: Array<{
    id: string
    transactionId: string
    merchantName: string
    payments: Array<{
      paymentSystem: string
      value: number
      referenceValue: number
    }>
  }>
  receiverUri?: string
  gatewayCallbackTemplatePath?: string
  messages?: Array<{ code: string; text: string; status?: string }>
  orderFormId?: string
  value?: number
  orders?: Array<{
    orderId: string
    orderGroup: string
    state: string
    value: number
    salesChannel: string
    totals: Array<{
      id: string
      name: string
      value: number
    }>
    items: VTEXOrderFormItem[]
    paymentData: {
      transactions: Array<{
        transactionId: string
        payments: Array<{
          paymentSystem: number
          paymentSystemName: string
          value: number
          installments: number
        }>
      }>
    }
  }>
  transactionData?: {
    merchantTransactions: Array<{
      id: string
      transactionId: string
      merchantName: string
      payments: Array<{
        paymentSystem: string
        value: number
        installments: number
        referenceValue: number
      }>
    }>
    receiverUri: string
    gatewayCallbackTemplatePath: string
  }
}

/**
 * Shape sent to `POST {paymentsHost}/api/pub/transactions/:tid/payments`.
 *
 * The endpoint takes a BARE ARRAY of these — wrapping in
 * `{payments: [...]}` triggers a .NET NullReferenceException on VTEX's
 * side. paymentSystem is a STRING here (matches what the orderForm's
 * paymentData echoes back; sending it as a number is silently rejected
 * by the gateway). `fields` stays empty for non-card methods (Cash,
 * promissory, redirect) — populate it only for direct card capture.
 */
export interface PaymentRequest {
  paymentSystem: string
  installments: number
  installmentsInterestRate: number
  installmentsValue: number
  value: number
  referenceValue: number
  fields: Record<string, string>
  transaction: {
    id: string
    merchantName: string
  }
  currencyCode: string
}

export interface AuthorizationResponse {
  orderId: string
  transactionId: string
  status: string
  authorizationToken?: string
  nsu?: string
  tid?: string
}
