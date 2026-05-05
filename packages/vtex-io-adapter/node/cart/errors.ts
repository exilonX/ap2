/**
 * Cart module — typed errors
 *
 * Hard-failure outcomes thrown by the Cart class. Caller code (REST handler
 * or chat-tool branch) maps these to status codes / LLM-steering messages.
 *
 * Soft outcomes (e.g. "coupon not applied") use a richer return shape
 * instead — see Cart.applyCoupon.
 */

export class InvalidSkuFormatError extends Error {
  constructor(public sku: string) {
    super(`Invalid SKU format: ${sku}`);
    this.name = 'InvalidSkuFormatError';
  }
}

export class ItemNotAddedError extends Error {
  constructor(public sku: string) {
    super(`SKU ${sku} not added by VTEX (likely unknown or out of stock)`);
    this.name = 'ItemNotAddedError';
  }
}

export class ItemNotInCartError extends Error {
  constructor(public sku: string) {
    super(`SKU ${sku} not in cart`);
    this.name = 'ItemNotInCartError';
  }
}

export class TransientCartError extends Error {
  constructor(public code: string) {
    super(`Transient VTEX cart error: ${code}`);
    this.name = 'TransientCartError';
  }
}

export class OrderFormSubstitutedError extends Error {
  constructor(public requested: string, public received: string) {
    super(
      `VTEX substituted orderFormId: requested ${requested}, received ${received}`
    );
    this.name = 'OrderFormSubstitutedError';
  }
}
