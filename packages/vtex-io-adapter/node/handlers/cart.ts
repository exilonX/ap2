/**
 * Cart Handlers
 *
 * Handle cart operations (add, remove, get, update).
 */

import { json } from 'co-body';
import { mapOrderFormToCart } from '../mappers/cart';
import { getOrCreateOrderForm, getOrderFormIdFromRequest } from '../utils/session';

/**
 * GET /_v/acg/cart
 * Get current cart
 */
export async function getCart(ctx: Context) {
  try {
    console.log('[ACG Cart] GET request');

    const orderFormId = await getOrCreateOrderForm(ctx);
    console.log('[ACG Cart] OrderFormId:', orderFormId);

    const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId);
    console.log('[ACG Cart] VTEX OrderForm:', `${orderForm.items?.length ?? 0} items, value: ${orderForm.value}`);

    const response = mapOrderFormToCart(orderForm);
    console.log('[ACG Cart] Response:', `${response.items?.length ?? 0} items, total: ${response.total}`);
    ctx.body = response;
  } catch (error) {
    console.error('Get cart error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to get cart',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /_v/acg/cart/items
 * Add item to cart
 */
export async function addToCart(ctx: Context) {
  try {
    const body = await json(ctx.req);
    const { sku, quantity = 1, seller = '1' } = body as {
      sku: string;
      quantity?: number;
      seller?: string;
    };

    console.log('[ACG Cart] ADD request:', { sku, quantity, seller });

    if (!sku) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Missing SKU' };
      return;
    }

    const orderFormId = await getOrCreateOrderForm(ctx);
    console.log('[ACG Cart] OrderFormId:', orderFormId);

    const orderForm = await ctx.clients.checkout.addItems(orderFormId, [
      { id: sku, quantity, seller },
    ]);

    console.log('[ACG Cart] VTEX OrderForm after add:', `${orderForm.items?.length ?? 0} items, value: ${orderForm.value}`);

    const cart = mapOrderFormToCart(orderForm);

    // Find the added item
    const addedItem = cart.items.find((item) => item.sku === sku);

    const response = {
      success: true,
      cart,
      addedItem,
    };

    console.log('[ACG Cart] ADD Response:', `success: ${response.success}, items: ${response.cart?.items?.length ?? 0}`);
    ctx.body = response;
  } catch (error) {
    console.error('Add to cart error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: 'Failed to add item to cart',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * DELETE /_v/acg/cart/items/:sku
 * Remove item from cart
 */
export async function removeFromCart(ctx: Context) {
  try {
    const sku = ctx.vtex.route?.params?.sku ?? ctx.params?.sku;

    console.log('[ACG Cart] REMOVE request:', { sku });

    if (!sku) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Missing SKU' };
      return;
    }

    const orderFormId = await getOrCreateOrderForm(ctx);
    const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId);

    // Find the item index
    const itemIndex = orderForm.items.findIndex((item) => item.id === sku);

    if (itemIndex === -1) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Item not found in cart' };
      return;
    }

    // Remove by setting quantity to 0
    const updatedOrderForm = await ctx.clients.checkout.removeItem(
      orderFormId,
      itemIndex
    );

    console.log('[ACG Cart] VTEX OrderForm after remove:', `${updatedOrderForm.items?.length ?? 0} items remaining`);

    const response = {
      success: true,
      cart: mapOrderFormToCart(updatedOrderForm),
    };

    console.log('[ACG Cart] REMOVE Response:', `success: ${response.success}, items: ${response.cart?.items?.length ?? 0}`);
    ctx.body = response;
  } catch (error) {
    console.error('Remove from cart error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: 'Failed to remove item from cart',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * PUT /_v/acg/cart/items
 * Update item quantity in cart
 */
export async function updateCartItem(ctx: Context) {
  try {
    const body = await json(ctx.req);
    const { sku, quantity } = body as { sku: string; quantity: number };

    console.log('[ACG Cart] UPDATE request:', { sku, quantity });

    if (!sku || quantity === undefined) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Missing SKU or quantity' };
      return;
    }

    const orderFormId = await getOrCreateOrderForm(ctx);
    const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId);

    // Find the item index
    const itemIndex = orderForm.items.findIndex((item) => item.id === sku);

    if (itemIndex === -1) {
      ctx.status = 404;
      ctx.body = { success: false, error: 'Item not found in cart' };
      return;
    }

    const updatedOrderForm = await ctx.clients.checkout.updateItems(orderFormId, [
      { index: itemIndex, quantity },
    ]);

    const cart = mapOrderFormToCart(updatedOrderForm);

    ctx.body = {
      success: true,
      cart,
    };
  } catch (error) {
    console.error('Update cart item error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: 'Failed to update item',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /_v/acg/cart/profile
 * Set customer profile data on the cart
 */
export async function setCustomerProfile(ctx: Context) {
  try {
    const body = await json(ctx.req);
    const { email, firstName, lastName, phone, document, documentType } = body as {
      email: string;
      firstName: string;
      lastName: string;
      phone?: string;
      document?: string;
      documentType?: string;
    };

    console.log('[ACG Cart] SET PROFILE request:', { email, firstName, lastName });

    if (!email || !firstName || !lastName) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Missing required fields: email, firstName, lastName' };
      return;
    }

    const orderFormId = await getOrCreateOrderForm(ctx);

    const updatedOrderForm = await ctx.clients.checkout.addClientProfileData(orderFormId, {
      email,
      firstName,
      lastName,
      phone,
      document,
      documentType,
      isCorporate: false,
    });

    const cart = mapOrderFormToCart(updatedOrderForm);

    ctx.body = {
      success: true,
      cart,
      message: `Profile set for ${firstName} ${lastName} (${email})`,
    };
  } catch (error) {
    console.error('Set customer profile error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: 'Failed to set customer profile',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /_v/acg/cart/shipping
 * Set shipping address on the cart
 */
export async function setShippingAddress(ctx: Context) {
  try {
    const body = await json(ctx.req);
    const { postalCode, city, state, country, street, number, neighborhood, complement, receiverName } = body as {
      postalCode: string;
      city: string;
      state: string;
      country?: string;
      street: string;
      number: string;
      neighborhood: string;
      complement?: string;
      receiverName?: string;
    };

    console.log('[ACG Cart] SET SHIPPING request:', { postalCode, city, state });

    if (!postalCode || !city || !state || !street || !number || !neighborhood) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Missing required address fields' };
      return;
    }

    const orderFormId = await getOrCreateOrderForm(ctx);

    // Get current orderForm to build logisticsInfo
    const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId);
    const logisticsInfo = orderForm.items.map((_: unknown, index: number) => ({
      itemIndex: index,
      selectedSla: 'Normal',
      selectedDeliveryChannel: 'delivery',
    }));

    const updatedOrderForm = await ctx.clients.checkout.addShippingData(orderFormId, {
      clearAddressIfPostalCodeNotFound: false,
      selectedAddresses: [
        {
          addressType: 'residential',
          receiverName: receiverName || '',
          postalCode,
          city,
          state,
          country: country || 'ROU',
          street,
          number,
          neighborhood,
          complement,
        },
      ],
      logisticsInfo,
    });

    const cart = mapOrderFormToCart(updatedOrderForm);

    ctx.body = {
      success: true,
      cart,
      message: `Shipping address set: ${street} ${number}, ${city}`,
    };
  } catch (error) {
    console.error('Set shipping address error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: 'Failed to set shipping address',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * GET /_v/acg/cart/shipping-options
 * Get available shipping options for the current cart
 */
export async function getShippingOptions(ctx: Context) {
  try {
    const orderFormId = getOrderFormIdFromRequest(ctx);

    if (!orderFormId) {
      ctx.body = { options: [], message: 'No cart found. Add items first.' };
      return;
    }

    const orderForm = await ctx.clients.checkout.simulateOrderForm(orderFormId);

    // Extract shipping options from logisticsInfo
    const logisticsInfo = orderForm.shippingData?.logisticsInfo as Array<{
      slas?: Array<{ id: string; name: string; price: number; shippingEstimate: string }>;
    }> | undefined;

    const shippingOptions = logisticsInfo?.[0]?.slas?.map((sla) => ({
      id: sla.id,
      name: sla.name,
      price: sla.price / 100, // VTEX shipping prices are in cents
      estimatedDelivery: sla.shippingEstimate,
    })) || [];

    ctx.body = {
      options: shippingOptions,
      hasAddress: !!(orderForm.shippingData?.address),
      message: shippingOptions.length === 0
        ? 'No shipping options available. Set a shipping address first.'
        : `${shippingOptions.length} shipping option(s) available.`,
    };
  } catch (error) {
    console.error('Get shipping options error:', error);
    ctx.status = 500;
    ctx.body = {
      error: 'Failed to get shipping options',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * POST /_v/acg/cart/coupon
 * Apply a coupon/promo code to the cart
 */
export async function applyCoupon(ctx: Context) {
  try {
    const body = await json(ctx.req);
    const { code } = body as { code: string };

    console.log('[ACG Cart] APPLY COUPON request:', { code });

    if (!code) {
      ctx.status = 400;
      ctx.body = { success: false, error: 'Missing coupon code' };
      return;
    }

    const orderFormId = await getOrCreateOrderForm(ctx);

    const updatedOrderForm = await ctx.clients.checkout.addCoupon(orderFormId, code);
    const cart = mapOrderFormToCart(updatedOrderForm);

    // Check if coupon was actually applied (look for marketing data or discount change)
    const hasDiscount = (cart.discount || 0) > 0;

    ctx.body = {
      success: true,
      cart,
      message: hasDiscount
        ? `Coupon "${code}" applied! Discount: ${cart.discount?.toFixed(2)} ${cart.currency}`
        : `Coupon "${code}" added but no discount was applied. The code may not be valid for these items.`,
    };
  } catch (error) {
    console.error('Apply coupon error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      error: 'Failed to apply coupon',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
