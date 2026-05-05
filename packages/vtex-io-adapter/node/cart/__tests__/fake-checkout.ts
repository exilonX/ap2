/**
 * FakeCheckoutClient — in-memory test double for the CheckoutClient.
 *
 * Test-only: do NOT export from the package. Mirrors the public methods
 * Cart depends on (`getOrderForm`, `addItems`, `updateItems`, `removeItem`,
 * `addCoupon`, `addClientProfileData`, `addShippingData`, `simulateOrderForm`,
 * `createOrderForm`).
 *
 * Injection points (each consumes itself after the next matching call):
 *
 *   - silentlyAccepts(sku): future addItems with this SKU returns the
 *     orderForm unchanged — simulating VTEX's silent-success bug for
 *     unknown SKUs.
 *   - failNextCall(method, error): one-shot failure injection.
 *   - substituteNextOrderFormId(replacement): one-shot id swap. The next
 *     orderForm-returning call returns a clone with this id instead.
 */

import type {
  ClientProfileData,
  ShippingData,
  VTEXOrderForm,
  VTEXOrderFormItem,
} from '../../clients/checkout';

type FakeMethod =
  | 'getOrderForm'
  | 'addItems'
  | 'updateItems'
  | 'removeItem'
  | 'addCoupon'
  | 'addClientProfileData'
  | 'addShippingData'
  | 'simulateOrderForm'
  | 'createOrderForm';

let fakeIdCounter = 1;

function newOrderFormId(): string {
  return `of-fake-${fakeIdCounter++}`;
}

/**
 * Build a minimal-but-realistic empty VTEXOrderForm with the given id.
 */
export function makeEmptyOrderForm(id: string = newOrderFormId()): VTEXOrderForm {
  return {
    orderFormId: id,
    salesChannel: '1',
    loggedIn: false,
    isCheckedIn: false,
    storeId: null,
    checkedInPickupPointId: null,
    allowManualPrice: false,
    canEditData: true,
    userProfileId: null,
    userType: null,
    ignoreProfileData: false,
    value: 0,
    messages: [],
    items: [],
    selectableGifts: [],
    totalizers: [],
    shippingData: {
      address: null,
      logisticsInfo: [],
      selectedAddresses: [],
      availableAddresses: [],
      pickupPoints: [],
    },
    clientProfileData: null,
    paymentData: {
      updateStatus: 'pending',
      installmentOptions: [],
      paymentSystems: [],
      payments: [],
      giftCards: [],
      giftCardMessages: [],
      availableAccounts: [],
      availableTokens: [],
    },
    marketingData: null,
    sellers: [{ id: '1', name: 'default', logo: '' }],
    clientPreferencesData: null,
    commercialConditionData: null,
    storePreferencesData: {
      countryCode: 'ROU',
      saveUserData: false,
      timeZone: 'Europe/Bucharest',
      currencyCode: 'RON',
      currencyLocale: 0,
      currencySymbol: 'RON',
      currencyFormatInfo: {},
    },
    giftRegistryData: null,
    openTextField: null,
    invoiceData: null,
    customData: null,
    itemMetadata: null,
    hooksData: null,
    ratesAndBenefitsData: null,
    subscriptionData: null,
    merchantContextData: null,
    itemsOrdination: null,
  };
}

/**
 * Build a minimal item. `unitPrice` is in cents (matches VTEX wire format).
 */
export function makeItem(
  sku: string,
  quantity: number,
  unitPriceCents: number = 5000
): VTEXOrderFormItem {
  return {
    uniqueId: `unique-${sku}`,
    id: sku,
    productId: `p-${sku}`,
    productRefId: '',
    refId: '',
    ean: null,
    name: `Product ${sku}`,
    skuName: `Variant ${sku}`,
    modalType: null,
    parentItemIndex: null,
    parentAssemblyBinding: null,
    assemblies: [],
    priceValidUntil: '2099-12-31T00:00:00Z',
    tax: 0,
    price: unitPriceCents,
    listPrice: unitPriceCents,
    manualPrice: null,
    manualPriceAppliedBy: null,
    sellingPrice: unitPriceCents,
    rewardValue: 0,
    isGift: false,
    additionalInfo: {
      dimension: null,
      brandName: '',
      brandId: '',
      offeringInfo: null,
      offeringType: null,
      offeringTypeId: null,
    },
    preSaleDate: null,
    productCategoryIds: '',
    productCategories: {},
    quantity,
    seller: '1',
    sellerChain: ['1'],
    imageUrl: '',
    detailUrl: '',
    components: [],
    bundleItems: [],
    attachments: [],
    attachmentOfferings: [],
    offerings: [],
    priceTags: [],
    availability: 'available',
    measurementUnit: 'un',
    unitMultiplier: 1,
    manufacturerCode: null,
    priceDefinition: null,
  };
}

/**
 * Recompute `value` and `Items` totalizer from items.
 */
function recomputeTotals(orderForm: VTEXOrderForm): void {
  orderForm.value = orderForm.items.reduce(
    (sum, i) => sum + i.sellingPrice * i.quantity,
    0
  );
  const itemsTotalizer = orderForm.totalizers.find((t) => t.id === 'Items');
  if (itemsTotalizer) {
    itemsTotalizer.value = orderForm.value;
  } else {
    orderForm.totalizers.push({ id: 'Items', name: 'Items', value: orderForm.value });
  }
}

function setDiscount(orderForm: VTEXOrderForm, discountCents: number): void {
  const t = orderForm.totalizers.find((x) => x.id === 'Discounts');
  if (t) {
    t.value = -Math.abs(discountCents);
  } else {
    orderForm.totalizers.push({
      id: 'Discounts',
      name: 'Discounts',
      value: -Math.abs(discountCents),
    });
  }
  orderForm.value = orderForm.value - Math.abs(discountCents);
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export interface CouponRule {
  /** Code that triggers a discount when applied. */
  code: string;
  /** Discount in cents to subtract from value. */
  discountCents: number;
}

export class FakeCheckoutClient {
  private store: Map<string, VTEXOrderForm> = new Map();

  // Injection state
  private silentlyAcceptedSkus: Set<string> = new Set();
  private nextFailures: Map<FakeMethod, Error> = new Map();
  private nextSubstitutedId: string | null = null;
  private couponRules: Map<string, number> = new Map(); // code -> discount cents

  // ─── Test injection points ────────────────────────────────────────

  /**
   * Future calls to `addItems` with this SKU will return the orderForm
   * unchanged — the SKU is NOT actually added. Simulates VTEX's silent
   * silent-success on unknown SKUs. Persistent (does not consume itself).
   */
  public silentlyAccepts(sku: string): void {
    this.silentlyAcceptedSkus.add(sku);
  }

  /**
   * The next call to `method` throws `error`. One-shot — consumes itself
   * after the matching call.
   */
  public failNextCall(method: FakeMethod, error: Error): void {
    this.nextFailures.set(method, error);
  }

  /**
   * The next orderForm-returning call returns a clone with this id
   * instead — simulating VTEX silently swapping orderFormId. One-shot.
   */
  public substituteNextOrderFormId(replacement: string): void {
    this.nextSubstitutedId = replacement;
  }

  /**
   * Configure a coupon: applying this code applies `discountCents` to the
   * orderForm.
   */
  public addCouponRule(code: string, discountCents: number): void {
    this.couponRules.set(code, discountCents);
  }

  // ─── Test helpers ─────────────────────────────────────────────────

  /**
   * Insert a pre-built orderForm into the store (for setting up fixtures).
   */
  public seed(orderForm: VTEXOrderForm): void {
    this.store.set(orderForm.orderFormId, orderForm);
  }

  // ─── Methods that mirror CheckoutClient ───────────────────────────

  public async createOrderForm(): Promise<VTEXOrderForm> {
    this.tripFailure('createOrderForm');
    const of = makeEmptyOrderForm();
    this.store.set(of.orderFormId, of);
    return this.maybeSubstituteId(of);
  }

  public async getOrderForm(orderFormId: string): Promise<VTEXOrderForm> {
    this.tripFailure('getOrderForm');
    const of = this.store.get(orderFormId);
    if (!of) {
      throw new Error(`FakeCheckoutClient: orderForm ${orderFormId} not found`);
    }
    return this.maybeSubstituteId(clone(of));
  }

  public async addItems(
    orderFormId: string,
    items: Array<{ id: string; quantity: number; seller: string }>
  ): Promise<VTEXOrderForm> {
    this.tripFailure('addItems');
    const of = this.requireOrderForm(orderFormId);
    for (const req of items) {
      if (this.silentlyAcceptedSkus.has(req.id)) {
        // Silent success: do not modify state.
        continue;
      }
      const existing = of.items.find((i) => i.id === req.id);
      if (existing) {
        existing.quantity += req.quantity;
      } else {
        of.items.push(makeItem(req.id, req.quantity));
      }
    }
    recomputeTotals(of);
    return this.maybeSubstituteId(clone(of));
  }

  public async updateItems(
    orderFormId: string,
    items: Array<{ index: number; quantity: number }>
  ): Promise<VTEXOrderForm> {
    this.tripFailure('updateItems');
    const of = this.requireOrderForm(orderFormId);
    // Sort descending so splices don't shift indexes we still need.
    const sorted = [...items].sort((a, b) => b.index - a.index);
    for (const req of sorted) {
      if (req.index < 0 || req.index >= of.items.length) {
        throw new Error(`FakeCheckoutClient: bad item index ${req.index}`);
      }
      if (req.quantity === 0) {
        of.items.splice(req.index, 1);
      } else {
        of.items[req.index].quantity = req.quantity;
      }
    }
    recomputeTotals(of);
    return this.maybeSubstituteId(clone(of));
  }

  public async removeItem(
    orderFormId: string,
    itemIndex: number
  ): Promise<VTEXOrderForm> {
    this.tripFailure('removeItem');
    return this.updateItems(orderFormId, [{ index: itemIndex, quantity: 0 }]);
  }

  public async addCoupon(
    orderFormId: string,
    couponCode: string
  ): Promise<VTEXOrderForm> {
    this.tripFailure('addCoupon');
    const of = this.requireOrderForm(orderFormId);
    const discount = this.couponRules.get(couponCode) ?? 0;
    if (discount > 0 && of.items.length > 0) {
      setDiscount(of, discount);
    }
    of.marketingData = of.marketingData ?? {};
    (of.marketingData as Record<string, unknown>).coupon = couponCode;
    return this.maybeSubstituteId(clone(of));
  }

  public async addClientProfileData(
    orderFormId: string,
    data: ClientProfileData
  ): Promise<VTEXOrderForm> {
    this.tripFailure('addClientProfileData');
    const of = this.requireOrderForm(orderFormId);
    of.clientProfileData = {
      email: data.email ?? null,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
      document: data.document ?? null,
      documentType: data.documentType ?? null,
      phone: data.phone ?? null,
      corporateName: data.corporateName ?? null,
      tradeName: data.tradeName ?? null,
      corporateDocument: data.corporateDocument ?? null,
      stateInscription: data.stateInscription ?? null,
      corporatePhone: data.corporatePhone ?? null,
      isCorporate: data.isCorporate ?? false,
      profileCompleteOnLoading: null,
      profileErrorOnLoading: null,
      customerClass: null,
    };
    return this.maybeSubstituteId(clone(of));
  }

  public async addShippingData(
    orderFormId: string,
    data: ShippingData
  ): Promise<VTEXOrderForm> {
    this.tripFailure('addShippingData');
    const of = this.requireOrderForm(orderFormId);
    of.shippingData = {
      address: data.selectedAddresses[0] ?? null,
      logisticsInfo: data.logisticsInfo,
      selectedAddresses: data.selectedAddresses,
      availableAddresses: [],
      pickupPoints: [],
    };
    return this.maybeSubstituteId(clone(of));
  }

  public async simulateOrderForm(orderFormId: string): Promise<VTEXOrderForm> {
    this.tripFailure('simulateOrderForm');
    const of = this.requireOrderForm(orderFormId);
    // Populate slas if a shipping address has been set, so getShippingOptions
    // can return something useful.
    if (of.shippingData.address) {
      of.shippingData.logisticsInfo = of.items.map((_, i) => ({
        itemIndex: i,
        selectedSla: 'Normal',
        selectedDeliveryChannel: 'delivery',
        slas: [
          {
            id: 'Normal',
            name: 'Normal',
            price: 1500, // 15.00 in major units
            shippingEstimate: '3bd',
          },
          {
            id: 'Express',
            name: 'Express',
            price: 3000,
            shippingEstimate: '1bd',
          },
        ],
      })) as unknown[];
    }
    return this.maybeSubstituteId(clone(of));
  }

  // ─── Internals ────────────────────────────────────────────────────

  private requireOrderForm(id: string): VTEXOrderForm {
    const of = this.store.get(id);
    if (!of) {
      throw new Error(`FakeCheckoutClient: orderForm ${id} not found`);
    }
    return of;
  }

  private tripFailure(method: FakeMethod): void {
    const err = this.nextFailures.get(method);
    if (err) {
      this.nextFailures.delete(method);
      throw err;
    }
  }

  private maybeSubstituteId(orderForm: VTEXOrderForm): VTEXOrderForm {
    if (this.nextSubstitutedId !== null) {
      const id = this.nextSubstitutedId;
      this.nextSubstitutedId = null;
      return { ...orderForm, orderFormId: id };
    }
    return orderForm;
  }
}
