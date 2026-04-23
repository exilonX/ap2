/**
 * Checkout Client
 *
 * Wraps VTEX Checkout API (orderForm operations).
 * Implements the headless checkout flow as per VTEX API documentation.
 */

import { ExternalClient, InstanceOptions, IOContext } from '@vtex/api';

export interface VTEXOrderForm {
  orderFormId: string;
  salesChannel: string;
  loggedIn: boolean;
  isCheckedIn: boolean;
  storeId: string | null;
  checkedInPickupPointId: string | null;
  allowManualPrice: boolean;
  canEditData: boolean;
  userProfileId: string | null;
  userType: string | null;
  ignoreProfileData: boolean;
  value: number;
  messages: unknown[];
  items: VTEXOrderFormItem[];
  selectableGifts: unknown[];
  totalizers: Array<{
    id: string;
    name: string;
    value: number;
  }>;
  shippingData: {
    address: unknown | null;
    logisticsInfo: unknown[];
    selectedAddresses: unknown[];
    availableAddresses: unknown[];
    pickupPoints: unknown[];
  };
  clientProfileData: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    document: string | null;
    documentType: string | null;
    phone: string | null;
    corporateName: string | null;
    tradeName: string | null;
    corporateDocument: string | null;
    stateInscription: string | null;
    corporatePhone: string | null;
    isCorporate: boolean;
    profileCompleteOnLoading: boolean | null;
    profileErrorOnLoading: boolean | null;
    customerClass: string | null;
  } | null;
  paymentData: {
    updateStatus: string;
    installmentOptions: unknown[];
    paymentSystems: unknown[];
    payments: unknown[];
    giftCards: unknown[];
    giftCardMessages: unknown[];
    availableAccounts: unknown[];
    availableTokens: unknown[];
  };
  marketingData: unknown | null;
  sellers: Array<{
    id: string;
    name: string;
    logo: string;
  }>;
  clientPreferencesData: unknown | null;
  commercialConditionData: unknown | null;
  storePreferencesData: {
    countryCode: string;
    saveUserData: boolean;
    timeZone: string;
    currencyCode: string;
    currencyLocale: number;
    currencySymbol: string;
    currencyFormatInfo: unknown;
  };
  giftRegistryData: unknown | null;
  openTextField: unknown | null;
  invoiceData: unknown | null;
  customData: unknown | null;
  itemMetadata: unknown | null;
  hooksData: unknown | null;
  ratesAndBenefitsData: unknown | null;
  subscriptionData: unknown | null;
  merchantContextData: unknown | null;
  itemsOrdination: unknown | null;
}

export interface VTEXOrderFormItem {
  uniqueId: string;
  id: string;
  productId: string;
  productRefId: string;
  refId: string;
  ean: string | null;
  name: string;
  skuName: string;
  modalType: string | null;
  parentItemIndex: number | null;
  parentAssemblyBinding: string | null;
  assemblies: unknown[];
  priceValidUntil: string;
  tax: number;
  price: number;
  listPrice: number;
  manualPrice: number | null;
  manualPriceAppliedBy: string | null;
  sellingPrice: number;
  rewardValue: number;
  isGift: boolean;
  additionalInfo: {
    dimension: unknown | null;
    brandName: string;
    brandId: string;
    offeringInfo: unknown | null;
    offeringType: unknown | null;
    offeringTypeId: unknown | null;
  };
  preSaleDate: string | null;
  productCategoryIds: string;
  productCategories: Record<string, string>;
  quantity: number;
  seller: string;
  sellerChain: string[];
  imageUrl: string;
  detailUrl: string;
  components: unknown[];
  bundleItems: unknown[];
  attachments: unknown[];
  attachmentOfferings: unknown[];
  offerings: unknown[];
  priceTags: unknown[];
  availability: string;
  measurementUnit: string;
  unitMultiplier: number;
  manufacturerCode: string | null;
  priceDefinition: unknown | null;
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
    });
  }

  /**
   * Create a new orderForm (cart)
   */
  public async createOrderForm(): Promise<VTEXOrderForm> {
    return this.http.post<VTEXOrderForm>(
      '/api/checkout/pub/orderForm',
      {},
      { metric: 'acg-create-orderform' }
    );
  }

  /**
   * Get existing orderForm
   */
  public async getOrderForm(orderFormId: string): Promise<VTEXOrderForm> {
    return this.http.get<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}`,
      { metric: 'acg-get-orderform' }
    );
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
    );
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
    );
  }

  /**
   * Remove item (set quantity to 0)
   */
  public async removeItem(
    orderFormId: string,
    itemIndex: number
  ): Promise<VTEXOrderForm> {
    return this.updateItems(orderFormId, [{ index: itemIndex, quantity: 0 }]);
  }

  /**
   * Simulate orderForm to get updated prices/shipping
   * This is useful before creating a mandate
   */
  public async simulateOrderForm(
    orderFormId: string
  ): Promise<VTEXOrderForm> {
    return this.http.get<VTEXOrderForm>(
      `/api/checkout/pub/orderForm/${orderFormId}`,
      { metric: 'acg-simulate' }
    );
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
    );
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
    );
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
    );
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
    );
  }

  /**
   * Place order (create transaction)
   * Step 6 in headless checkout flow
   * Returns order information including transactionId
   */
  public async placeOrder(
    orderFormId: string,
    referenceId: string,
    savePersonalData?: boolean
  ): Promise<PlaceOrderResponse> {
    return this.http.post<PlaceOrderResponse>(
      `/api/checkout/pub/orderForm/${orderFormId}/transaction`,
      {
        referenceId,
        savePersonalData: savePersonalData ?? false,
      },
      { metric: 'acg-place-order' }
    );
  }

  /**
   * Get order details by order ID
   */
  public async getOrder(orderId: string): Promise<any> {
    return this.http.get(
      `/api/oms/pvt/orders/${orderId}`,
      { metric: 'acg-get-order' }
    );
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
    });
  }

  /**
   * Send payment information
   * Step 7 in headless checkout flow
   */
  public async sendPayments(
    transactionId: string,
    payments: PaymentRequest[]
  ): Promise<unknown> {
    return this.http.post(
      `/api/pub/transactions/${transactionId}/payments`,
      payments,
      { metric: 'acg-send-payments' }
    );
  }

  /**
   * Authorize payment / Start transaction
   * Step 8 (final) in headless checkout flow
   */
  public async authorizeTransaction(
    transactionId: string,
    orderId: string,
    callbackUrl?: string
  ): Promise<AuthorizationResponse> {
    return this.http.post<AuthorizationResponse>(
      `/api/pvt/transactions/${transactionId}/authorization-request`,
      {
        transactionId,
        softDescriptor: 'ACG Purchase',
        prepareForRecurrency: false,
        split: [],
        callbackUrl: callbackUrl || '',
        orderId,
      },
      { metric: 'acg-authorize-payment' }
    );
  }
}

// Type definitions for checkout flow

export interface ClientProfileData {
  email: string;
  firstName: string;
  lastName: string;
  documentType?: string;
  document?: string;
  phone?: string;
  corporateName?: string | null;
  tradeName?: string | null;
  corporateDocument?: string | null;
  stateInscription?: string | null;
  corporatePhone?: string | null;
  isCorporate?: boolean;
}

export interface ShippingAddress {
  addressType: string;
  receiverName: string;
  addressId?: string;
  isDisposable?: boolean;
  postalCode: string;
  city: string;
  state: string;
  country: string;
  street: string;
  number: string;
  neighborhood: string;
  complement?: string;
  reference?: string;
  geoCoordinates?: [number, number];
}

export interface LogisticsInfo {
  itemIndex: number;
  selectedSla: string;
  selectedDeliveryChannel?: string;
  addressId?: string;
  price?: number;
}

export interface ShippingData {
  clearAddressIfPostalCodeNotFound?: boolean;
  selectedAddresses: ShippingAddress[];
  logisticsInfo: LogisticsInfo[];
}

export interface PaymentData {
  payments: Array<{
    paymentSystem: number;
    installments: number;
    referenceValue: number;
    value: number;
    currencyCode?: string;
  }>;
}

export interface PlaceOrderResponse {
  orderGroup: string;
  orders: Array<{
    orderId: string;
    orderGroup: string;
    state: string;
    value: number;
    salesChannel: string;
    totals: Array<{
      id: string;
      name: string;
      value: number;
    }>;
    items: VTEXOrderFormItem[];
    paymentData: {
      transactions: Array<{
        transactionId: string;
        payments: Array<{
          paymentSystem: number;
          paymentSystemName: string;
          value: number;
          installments: number;
        }>;
      }>;
    };
  }>;
  transactionData: {
    merchantTransactions: Array<{
      id: string;
      transactionId: string;
      merchantName: string;
      payments: Array<{
        paymentSystem: string;
        value: number;
        installments: number;
        referenceValue: number;
      }>;
    }>;
    receiverUri: string;
    gatewayCallbackTemplatePath: string;
  };
}

export interface PaymentRequest {
  paymentSystem: number;
  paymentSystemName: string;
  group: string;
  installments: number;
  installmentsInterestRate: number;
  installmentsValue: number;
  value: number;
  referenceValue: number;
  fields: {
    holderName: string;
    cardNumber: string;
    validationCode: string;
    dueDate: string;
    document?: string;
    accountId?: string;
    address?: unknown;
  };
  transaction: {
    id: string;
    merchantName: string;
  };
  currencyCode?: string;
}

export interface AuthorizationResponse {
  orderId: string;
  transactionId: string;
  status: string;
  authorizationToken?: string;
  nsu?: string;
  tid?: string;
}
