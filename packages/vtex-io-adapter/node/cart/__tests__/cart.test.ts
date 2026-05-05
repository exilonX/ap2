/**
 * Cart module tests.
 *
 * Covers:
 *   - happy path for all 9 operations
 *   - cross-cutting rules (sec D of the spec)
 *   - orderForm-substitution detection
 *   - applyCoupon's richer return shape
 *   - typed errors carry the right `.sku`
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Cart } from '../cart';
import {
  InvalidSkuFormatError,
  ItemNotAddedError,
  ItemNotInCartError,
  OrderFormSubstitutedError,
  TransientCartError,
} from '../errors';
import {
  FakeCheckoutClient,
  makeEmptyOrderForm,
  makeItem,
} from './fake-checkout';
import type { CheckoutClient } from '../../clients/checkout';

// The Fake satisfies the public methods Cart depends on. We cast through
// `unknown` since we don't implement the private VTEX HTTP plumbing.
function asCheckoutClient(fake: FakeCheckoutClient): CheckoutClient {
  return fake as unknown as CheckoutClient;
}

function setupCart() {
  const fake = new FakeCheckoutClient();
  const empty = makeEmptyOrderForm('of-1');
  fake.seed(empty);
  const cart = new Cart({ checkout: asCheckoutClient(fake) });
  return { fake, cart, orderFormId: empty.orderFormId };
}

// ─── getCart ────────────────────────────────────────────────────────

describe('Cart.getCart', () => {
  it('returns mapped SimpleCart for a valid orderFormId', async () => {
    const { fake, cart, orderFormId } = setupCart();
    const seeded = makeEmptyOrderForm(orderFormId);
    seeded.items.push(makeItem('111', 2, 5000));
    seeded.value = 10000;
    fake.seed(seeded);

    const result = await cart.getCart(orderFormId);
    assert.equal(result.id, orderFormId);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sku, '111');
    assert.equal(result.items[0].quantity, 2);
    assert.equal(result.itemCount, 2);
    assert.equal(result.total, 100); // 10000 cents = 100
  });

  it('throws OrderFormSubstitutedError when VTEX swaps the id', async () => {
    const { fake, cart, orderFormId } = setupCart();
    fake.substituteNextOrderFormId('of-other');

    await assert.rejects(
      () => cart.getCart(orderFormId),
      (err: Error) => {
        assert.ok(err instanceof OrderFormSubstitutedError);
        assert.equal((err as OrderFormSubstitutedError).requested, orderFormId);
        assert.equal((err as OrderFormSubstitutedError).received, 'of-other');
        return true;
      }
    );
  });
});

// ─── addItem ────────────────────────────────────────────────────────

describe('Cart.addItem', () => {
  it('happy path: adds an item and returns the updated cart', async () => {
    const { cart, orderFormId } = setupCart();

    const result = await cart.addItem(orderFormId, '111', 1);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sku, '111');
    assert.equal(result.items[0].quantity, 1);
  });

  it('rejects fabricated SKUs with InvalidSkuFormatError', async () => {
    const { cart, orderFormId } = setupCart();

    await assert.rejects(
      () => cart.addItem(orderFormId, '588600_M', 1),
      (err: Error) => {
        assert.ok(err instanceof InvalidSkuFormatError);
        assert.equal((err as InvalidSkuFormatError).sku, '588600_M');
        return true;
      }
    );
  });

  it('retries on ORD003 with 350ms backoff and succeeds', async () => {
    const { fake, cart, orderFormId } = setupCart();
    fake.failNextCall('addItems', new Error('VTEX ORD003: rates and benefits transient error'));

    const t0 = Date.now();
    const result = await cart.addItem(orderFormId, '111', 1);
    const elapsed = Date.now() - t0;

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sku, '111');
    assert.ok(elapsed >= 300, `expected at least 300ms backoff, got ${elapsed}ms`);
  });

  it('throws TransientCartError if ORD003 persists after retry', async () => {
    const { fake, cart, orderFormId } = setupCart();
    // Patch addItems to always throw ORD003.
    const originalAddItems = fake.addItems.bind(fake);
    fake.addItems = async () => {
      throw new Error('VTEX ORD003: rates and benefits transient error');
    };

    await assert.rejects(
      () => cart.addItem(orderFormId, '111', 1),
      (err: Error) => {
        assert.ok(err instanceof TransientCartError);
        assert.equal((err as TransientCartError).code, 'ORD003');
        return true;
      }
    );

    fake.addItems = originalAddItems;
  });

  it('detects VTEX silent-success bug and throws ItemNotAddedError', async () => {
    const { fake, cart, orderFormId } = setupCart();
    fake.silentlyAccepts('111');

    await assert.rejects(
      () => cart.addItem(orderFormId, '111', 1),
      (err: Error) => {
        assert.ok(err instanceof ItemNotAddedError);
        assert.equal((err as ItemNotAddedError).sku, '111');
        return true;
      }
    );
  });

  it('throws OrderFormSubstitutedError when VTEX swaps the id', async () => {
    const { fake, cart, orderFormId } = setupCart();
    // Substitute on the first call (the qty-before snapshot).
    fake.substituteNextOrderFormId('of-other');

    await assert.rejects(
      () => cart.addItem(orderFormId, '111', 1),
      OrderFormSubstitutedError
    );
  });
});

// ─── removeBySku ────────────────────────────────────────────────────

describe('Cart.removeBySku', () => {
  it('happy path: removes an item by SKU', async () => {
    const { fake, cart, orderFormId } = setupCart();
    const seeded = makeEmptyOrderForm(orderFormId);
    seeded.items.push(makeItem('111', 1, 5000));
    seeded.items.push(makeItem('222', 1, 5000));
    seeded.value = 10000;
    fake.seed(seeded);

    const result = await cart.removeBySku(orderFormId, '111');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sku, '222');
  });

  it('throws ItemNotInCartError if SKU not present', async () => {
    const { cart, orderFormId } = setupCart();

    await assert.rejects(
      () => cart.removeBySku(orderFormId, '999'),
      (err: Error) => {
        assert.ok(err instanceof ItemNotInCartError);
        assert.equal((err as ItemNotInCartError).sku, '999');
        return true;
      }
    );
  });
});

// ─── setQuantity ────────────────────────────────────────────────────

describe('Cart.setQuantity', () => {
  it('happy path: updates quantity', async () => {
    const { fake, cart, orderFormId } = setupCart();
    const seeded = makeEmptyOrderForm(orderFormId);
    seeded.items.push(makeItem('111', 1, 5000));
    seeded.value = 5000;
    fake.seed(seeded);

    const result = await cart.setQuantity(orderFormId, '111', 3);
    assert.equal(result.items[0].quantity, 3);
  });

  it('qty=0 removes the item (matches VTEX semantics)', async () => {
    const { fake, cart, orderFormId } = setupCart();
    const seeded = makeEmptyOrderForm(orderFormId);
    seeded.items.push(makeItem('111', 1, 5000));
    seeded.value = 5000;
    fake.seed(seeded);

    const result = await cart.setQuantity(orderFormId, '111', 0);
    assert.equal(result.items.length, 0);
  });

  it('throws ItemNotInCartError if SKU not present', async () => {
    const { cart, orderFormId } = setupCart();

    await assert.rejects(
      () => cart.setQuantity(orderFormId, '999', 5),
      ItemNotInCartError
    );
  });

  it('rejects fabricated SKUs', async () => {
    const { cart, orderFormId } = setupCart();
    await assert.rejects(
      () => cart.setQuantity(orderFormId, 'abc', 1),
      InvalidSkuFormatError
    );
  });
});

// ─── applyCoupon ────────────────────────────────────────────────────

describe('Cart.applyCoupon', () => {
  it('returns { applied: true } when discount delta > 0', async () => {
    const { fake, cart, orderFormId } = setupCart();
    const seeded = makeEmptyOrderForm(orderFormId);
    seeded.items.push(makeItem('111', 1, 10000));
    seeded.value = 10000;
    fake.seed(seeded);
    fake.addCouponRule('SAVE10', 1000); // 10.00 off

    const result = await cart.applyCoupon(orderFormId, 'SAVE10');
    assert.equal(result.applied, true);
    assert.equal(result.reason, undefined);
    assert.equal(result.cart.discount, 10); // 1000 cents = 10
  });

  it('returns { applied: false, reason } when no discount applied', async () => {
    const { fake, cart, orderFormId } = setupCart();
    const seeded = makeEmptyOrderForm(orderFormId);
    seeded.items.push(makeItem('111', 1, 10000));
    seeded.value = 10000;
    fake.seed(seeded);
    // No coupon rule for INVALID — fake will not apply discount.

    const result = await cart.applyCoupon(orderFormId, 'INVALID');
    assert.equal(result.applied, false);
    assert.ok(result.reason && result.reason.length > 0);
  });
});

// ─── setCustomerProfile ─────────────────────────────────────────────

describe('Cart.setCustomerProfile', () => {
  it('persists profile data with isCorporate=false', async () => {
    const { fake, cart, orderFormId } = setupCart();

    await cart.setCustomerProfile(orderFormId, {
      email: 'x@example.com',
      firstName: 'X',
      lastName: 'Y',
    });

    const stored = await fake.getOrderForm(orderFormId);
    assert.equal(stored.clientProfileData?.email, 'x@example.com');
    assert.equal(stored.clientProfileData?.isCorporate, false);
  });
});

// ─── setShippingAddress ─────────────────────────────────────────────

describe('Cart.setShippingAddress', () => {
  it('builds logisticsInfo from current items and persists address', async () => {
    const { fake, cart, orderFormId } = setupCart();
    const seeded = makeEmptyOrderForm(orderFormId);
    seeded.items.push(makeItem('111', 1));
    seeded.items.push(makeItem('222', 1));
    fake.seed(seeded);

    await cart.setShippingAddress(orderFormId, {
      postalCode: '010101',
      city: 'Bucharest',
      state: 'B',
      street: 'Calea Victoriei',
      number: '1',
      neighborhood: 'Centru',
    });

    const stored = await fake.getOrderForm(orderFormId);
    assert.equal(stored.shippingData.logisticsInfo.length, 2);
    const firstAddr = stored.shippingData.selectedAddresses[0] as { country: string };
    assert.equal(firstAddr.country, 'ROU'); // default
  });
});

// ─── getShippingOptions ─────────────────────────────────────────────

describe('Cart.getShippingOptions', () => {
  it('returns ShippingOption list after a shipping address is set', async () => {
    const { fake, cart, orderFormId } = setupCart();
    const seeded = makeEmptyOrderForm(orderFormId);
    seeded.items.push(makeItem('111', 1));
    fake.seed(seeded);
    await cart.setShippingAddress(orderFormId, {
      postalCode: '010101',
      city: 'Bucharest',
      state: 'B',
      street: 'X',
      number: '1',
      neighborhood: 'Y',
    });

    const options = await cart.getShippingOptions(orderFormId);
    assert.ok(options.length >= 1);
    assert.ok(typeof options[0].id === 'string');
    assert.ok(typeof options[0].name === 'string');
    assert.ok(typeof options[0].price === 'number');
    assert.ok(typeof options[0].estimatedDelivery === 'string');
    // Price returned in major units (VTEX returns cents).
    assert.equal(options[0].price, 15);
  });

  it('returns [] when no shipping address has been set', async () => {
    const { cart, orderFormId } = setupCart();
    const options = await cart.getShippingOptions(orderFormId);
    assert.deepEqual(options, []);
  });
});

// ─── createCart ─────────────────────────────────────────────────────

describe('Cart.createCart', () => {
  it('returns a SimpleCart with a fresh id', async () => {
    const fake = new FakeCheckoutClient();
    const cart = new Cart({ checkout: asCheckoutClient(fake) });

    const result = await cart.createCart();
    assert.ok(result.id.startsWith('of-fake-'));
    assert.equal(result.items.length, 0);
    assert.equal(result.itemCount, 0);
  });
});
