/**
 * Cart Handlers
 *
 * Handle cart operations (add, remove, get).
 */

import { json } from 'co-body';
import { mapOrderFormToCart } from '../mappers/cart';
import { getOrCreateOrderForm } from '../utils/session';

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
    console.log('[ACG Cart] VTEX OrderForm:', JSON.stringify(orderForm, null, 2));

    const response = mapOrderFormToCart(orderForm);
    console.log('[ACG Cart] Response:', JSON.stringify(response, null, 2));
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

    console.log('[ACG Cart] VTEX OrderForm after add:', JSON.stringify(orderForm, null, 2));

    const cart = mapOrderFormToCart(orderForm);

    // Find the added item
    const addedItem = cart.items.find((item) => item.sku === sku);

    const response = {
      success: true,
      cart,
      addedItem,
    };

    console.log('[ACG Cart] ADD Response:', JSON.stringify(response, null, 2));
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
    const { sku } = ctx.params;

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

    console.log('[ACG Cart] VTEX OrderForm after remove:', JSON.stringify(updatedOrderForm, null, 2));

    const response = {
      success: true,
      cart: mapOrderFormToCart(updatedOrderForm),
    };

    console.log('[ACG Cart] REMOVE Response:', JSON.stringify(response, null, 2));
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
