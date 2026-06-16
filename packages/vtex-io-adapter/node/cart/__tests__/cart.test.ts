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

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { Cart } from '../cart'
import {
  InvalidSkuFormatError,
  ItemNotAddedError,
  ItemNotInCartError,
  OrderFormSubstitutedError,
  TransientCartError,
} from '../errors'
import {
  FakeCheckoutClient,
  makeEmptyOrderForm,
  makeItem,
} from './fake-checkout'
import type { CheckoutClient } from '../../clients/checkout'

// The Fake satisfies the public methods Cart depends on. We cast through
// `unknown` since we don't implement the private VTEX HTTP plumbing.
function asCheckoutClient(fake: FakeCheckoutClient): CheckoutClient {
  return (fake as unknown) as CheckoutClient
}

function setupCart() {
  const fake = new FakeCheckoutClient()
  const empty = makeEmptyOrderForm('of-1')

  fake.seed(empty)
  const cart = new Cart({ checkout: asCheckoutClient(fake) })

  return { fake, cart, orderFormId: empty.orderFormId }
}

// ─── getCart ────────────────────────────────────────────────────────

describe('Cart.getCart', () => {
  it('returns mapped SimpleCart for a valid orderFormId', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 2, 5000))
    seeded.value = 10000
    fake.seed(seeded)

    const result = await cart.getCart(orderFormId)

    assert.equal(result.id, orderFormId)
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].sku, '111')
    assert.equal(result.items[0].quantity, 2)
    assert.equal(result.itemCount, 2)
    assert.equal(result.total, 100) // 10000 cents = 100
  })

  it('throws OrderFormSubstitutedError when VTEX swaps the id', async () => {
    const { fake, cart, orderFormId } = setupCart()

    fake.substituteNextOrderFormId('of-other')

    await assert.rejects(
      () => cart.getCart(orderFormId),
      (err: Error) => {
        assert.ok(err instanceof OrderFormSubstitutedError)
        assert.equal((err as OrderFormSubstitutedError).requested, orderFormId)
        assert.equal((err as OrderFormSubstitutedError).received, 'of-other')

        return true
      }
    )
  })
})

// ─── addItem ────────────────────────────────────────────────────────

describe('Cart.addItem', () => {
  it('happy path: adds an item and returns the updated cart', async () => {
    const { cart, orderFormId } = setupCart()

    const result = await cart.addItem(orderFormId, '111', 1)

    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].sku, '111')
    assert.equal(result.items[0].quantity, 1)
  })

  it('rejects fabricated SKUs with InvalidSkuFormatError', async () => {
    const { cart, orderFormId } = setupCart()

    await assert.rejects(
      () => cart.addItem(orderFormId, '588600_M', 1),
      (err: Error) => {
        assert.ok(err instanceof InvalidSkuFormatError)
        assert.equal((err as InvalidSkuFormatError).sku, '588600_M')

        return true
      }
    )
  })

  it('retries on ORD003 with 350ms backoff and succeeds', async () => {
    const { fake, cart, orderFormId } = setupCart()

    fake.failNextCall(
      'addItems',
      new Error('VTEX ORD003: rates and benefits transient error')
    )

    const t0 = Date.now()
    const result = await cart.addItem(orderFormId, '111', 1)
    const elapsed = Date.now() - t0

    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].sku, '111')
    assert.ok(
      elapsed >= 300,
      `expected at least 300ms backoff, got ${elapsed}ms`
    )
  })

  it('throws TransientCartError if ORD003 persists after retry', async () => {
    const { fake, cart, orderFormId } = setupCart()
    // Patch addItems to always throw ORD003.
    const originalAddItems = fake.addItems.bind(fake)

    fake.addItems = async () => {
      throw new Error('VTEX ORD003: rates and benefits transient error')
    }

    await assert.rejects(
      () => cart.addItem(orderFormId, '111', 1),
      (err: Error) => {
        assert.ok(err instanceof TransientCartError)
        assert.equal((err as TransientCartError).code, 'ORD003')

        return true
      }
    )

    fake.addItems = originalAddItems
  })

  it('detects VTEX silent-success bug and throws ItemNotAddedError', async () => {
    const { fake, cart, orderFormId } = setupCart()

    fake.silentlyAccepts('111')

    await assert.rejects(
      () => cart.addItem(orderFormId, '111', 1),
      (err: Error) => {
        assert.ok(err instanceof ItemNotAddedError)
        assert.equal((err as ItemNotAddedError).sku, '111')

        return true
      }
    )
  })

  it('throws OrderFormSubstitutedError when VTEX swaps the id', async () => {
    const { fake, cart, orderFormId } = setupCart()

    // Substitute on the first call (the qty-before snapshot).
    fake.substituteNextOrderFormId('of-other')

    await assert.rejects(
      () => cart.addItem(orderFormId, '111', 1),
      OrderFormSubstitutedError
    )
  })
})

// ─── removeBySku ────────────────────────────────────────────────────

describe('Cart.removeBySku', () => {
  it('happy path: removes an item by SKU', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1, 5000))
    seeded.items.push(makeItem('222', 1, 5000))
    seeded.value = 10000
    fake.seed(seeded)

    const result = await cart.removeBySku(orderFormId, '111')

    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].sku, '222')
  })

  it('throws ItemNotInCartError if SKU not present', async () => {
    const { cart, orderFormId } = setupCart()

    await assert.rejects(
      () => cart.removeBySku(orderFormId, '999'),
      (err: Error) => {
        assert.ok(err instanceof ItemNotInCartError)
        assert.equal((err as ItemNotInCartError).sku, '999')

        return true
      }
    )
  })
})

// ─── setQuantity ────────────────────────────────────────────────────

describe('Cart.setQuantity', () => {
  it('happy path: updates quantity', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1, 5000))
    seeded.value = 5000
    fake.seed(seeded)

    const result = await cart.setQuantity(orderFormId, '111', 3)

    assert.equal(result.items[0].quantity, 3)
  })

  it('qty=0 removes the item (matches VTEX semantics)', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1, 5000))
    seeded.value = 5000
    fake.seed(seeded)

    const result = await cart.setQuantity(orderFormId, '111', 0)

    assert.equal(result.items.length, 0)
  })

  it('throws ItemNotInCartError if SKU not present', async () => {
    const { cart, orderFormId } = setupCart()

    await assert.rejects(
      () => cart.setQuantity(orderFormId, '999', 5),
      ItemNotInCartError
    )
  })

  it('rejects fabricated SKUs', async () => {
    const { cart, orderFormId } = setupCart()

    await assert.rejects(
      () => cart.setQuantity(orderFormId, 'abc', 1),
      InvalidSkuFormatError
    )
  })
})

// ─── applyCoupon ────────────────────────────────────────────────────

describe('Cart.applyCoupon', () => {
  it('returns { applied: true } when discount delta > 0', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1, 10000))
    seeded.value = 10000
    fake.seed(seeded)
    fake.addCouponRule('SAVE10', 1000) // 10.00 off

    const result = await cart.applyCoupon(orderFormId, 'SAVE10')

    assert.equal(result.applied, true)
    assert.equal(result.reason, undefined)
    assert.equal(result.cart.discount, 10) // 1000 cents = 10
  })

  it('returns { applied: false, reason } when no discount applied', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1, 10000))
    seeded.value = 10000
    fake.seed(seeded)
    // No coupon rule for INVALID — fake will not apply discount.

    const result = await cart.applyCoupon(orderFormId, 'INVALID')

    assert.equal(result.applied, false)
    assert.ok(result.reason && result.reason.length > 0)
  })
})

// ─── setCustomerProfile ─────────────────────────────────────────────

describe('Cart.setCustomerProfile', () => {
  it('persists profile data with isCorporate=false', async () => {
    const { fake, cart, orderFormId } = setupCart()

    await cart.setCustomerProfile(orderFormId, {
      email: 'x@example.com',
      firstName: 'X',
      lastName: 'Y',
    })

    const stored = await fake.getOrderForm(orderFormId)

    assert.equal(stored.clientProfileData?.email, 'x@example.com')
    assert.equal(stored.clientProfileData?.isCorporate, false)
  })

  it('rewrites a leading +40 phone to local 0-prefixed format', async () => {
    const { fake, cart, orderFormId } = setupCart()

    await cart.setCustomerProfile(orderFormId, {
      email: 'x@example.com',
      firstName: 'X',
      lastName: 'Y',
      phone: '+40700123456',
    })

    const stored = await fake.getOrderForm(orderFormId)

    assert.equal(stored.clientProfileData?.phone, '0700123456')
  })

  it('passes through an already-local phone unchanged', async () => {
    const { fake, cart, orderFormId } = setupCart()

    await cart.setCustomerProfile(orderFormId, {
      email: 'x@example.com',
      firstName: 'X',
      lastName: 'Y',
      phone: '0730197176',
    })

    const stored = await fake.getOrderForm(orderFormId)

    assert.equal(stored.clientProfileData?.phone, '0730197176')
  })

  it('defaults documentType to "document" when omitted', async () => {
    const { fake, cart, orderFormId } = setupCart()

    await cart.setCustomerProfile(orderFormId, {
      email: 'x@example.com',
      firstName: 'X',
      lastName: 'Y',
    })

    const stored = await fake.getOrderForm(orderFormId)

    assert.equal(stored.clientProfileData?.documentType, 'document')
  })

  it('lets an explicit documentType win over the default', async () => {
    const { fake, cart, orderFormId } = setupCart()

    await cart.setCustomerProfile(orderFormId, {
      email: 'x@example.com',
      firstName: 'X',
      lastName: 'Y',
      documentType: 'cnp',
    })

    const stored = await fake.getOrderForm(orderFormId)

    assert.equal(stored.clientProfileData?.documentType, 'cnp')
  })
})

// ─── setShippingAddress ─────────────────────────────────────────────

describe('Cart.setShippingAddress', () => {
  it('builds logisticsInfo from current items and persists address', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1))
    seeded.items.push(makeItem('222', 1))
    fake.seed(seeded)

    await cart.setShippingAddress(orderFormId, {
      postalCode: '010101',
      city: 'Bucharest',
      state: 'B',
      street: 'Calea Victoriei',
      number: '1',
      neighborhood: 'Centru',
    })

    const stored = await fake.getOrderForm(orderFormId)

    assert.equal(stored.shippingData.logisticsInfo.length, 2)
    const firstAddr = stored.shippingData.selectedAddresses[0] as {
      country: string
    }

    assert.equal(firstAddr.country, 'ROU') // default
  })

  it('derives receiverName from existing clientProfileData when omitted', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1))
    seeded.clientProfileData = ({
      email: 'x@example.com',
      firstName: 'Ionel',
      lastName: 'Merca',
      isCorporate: false,
    } as unknown) as typeof seeded.clientProfileData
    fake.seed(seeded)

    await cart.setShippingAddress(orderFormId, {
      postalCode: '417571',
      city: 'Adoni',
      state: 'BIHOR',
      street: 'nucilor',
      number: '2',
    })

    const stored = await fake.getOrderForm(orderFormId)
    const firstAddr = stored.shippingData.selectedAddresses[0] as {
      receiverName: string
    }

    assert.equal(firstAddr.receiverName, 'Ionel Merca')
  })

  it('keeps explicit receiverName over the profile-derived one', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1))
    seeded.clientProfileData = ({
      email: 'x@example.com',
      firstName: 'Ionel',
      lastName: 'Merca',
      isCorporate: false,
    } as unknown) as typeof seeded.clientProfileData
    fake.seed(seeded)

    await cart.setShippingAddress(orderFormId, {
      postalCode: '417571',
      city: 'Adoni',
      state: 'BIHOR',
      street: 'nucilor',
      number: '2',
      receiverName: 'Cineva Altcineva',
    })

    const stored = await fake.getOrderForm(orderFormId)
    const firstAddr = stored.shippingData.selectedAddresses[0] as {
      receiverName: string
    }

    assert.equal(firstAddr.receiverName, 'Cineva Altcineva')
  })

  it('omits neighborhood from selectedAddresses[0] when undefined', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1))
    fake.seed(seeded)

    await cart.setShippingAddress(orderFormId, {
      postalCode: '417571',
      city: 'Adoni',
      state: 'BIHOR',
      street: 'nucilor',
      number: '2',
    })

    const stored = await fake.getOrderForm(orderFormId)
    const firstAddr = stored.shippingData.selectedAddresses[0] as Record<
      string,
      unknown
    >

    // Key should be absent, not present-with-empty-string.
    assert.equal('neighborhood' in firstAddr, false)
  })

  it('includes neighborhood verbatim when provided', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1))
    fake.seed(seeded)

    await cart.setShippingAddress(orderFormId, {
      postalCode: '010101',
      city: 'Bucharest',
      state: 'B',
      street: 'Calea Victoriei',
      number: '1',
      neighborhood: 'Sector 1',
    })

    const stored = await fake.getOrderForm(orderFormId)
    const firstAddr = stored.shippingData.selectedAddresses[0] as {
      neighborhood?: string
    }

    assert.equal(firstAddr.neighborhood, 'Sector 1')
  })
})

// ─── getShippingOptions ─────────────────────────────────────────────

describe('Cart.getShippingOptions', () => {
  it('returns ShippingOption list after a shipping address is set', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1))
    fake.seed(seeded)
    await cart.setShippingAddress(orderFormId, {
      postalCode: '010101',
      city: 'Bucharest',
      state: 'B',
      street: 'X',
      number: '1',
      neighborhood: 'Y',
    })

    const options = await cart.getShippingOptions(orderFormId)

    assert.ok(options.length >= 1)
    assert.ok(typeof options[0].id === 'string')
    assert.ok(typeof options[0].name === 'string')
    assert.ok(typeof options[0].price === 'number')
    assert.ok(typeof options[0].estimatedDelivery === 'string')
    // Price returned in major units (VTEX returns cents).
    assert.equal(options[0].price, 15)
  })

  it('returns [] when no shipping address has been set', async () => {
    const { cart, orderFormId } = setupCart()
    const options = await cart.getShippingOptions(orderFormId)

    assert.deepEqual(options, [])
  })
})

// ─── createCart ─────────────────────────────────────────────────────

describe('Cart.createCart', () => {
  it('returns a SimpleCart with a fresh id', async () => {
    const fake = new FakeCheckoutClient()
    const cart = new Cart({ checkout: asCheckoutClient(fake) })

    const result = await cart.createCart()

    assert.ok(result.id.startsWith('of-fake-'))
    assert.equal(result.items.length, 0)
    assert.equal(result.itemCount, 0)
  })
})

// ─── getAvailablePaymentSystems ─────────────────────────────────────

describe('Cart.getAvailablePaymentSystems', () => {
  it('returns normalized payment methods configured on the orderForm', async () => {
    const { fake, cart, orderFormId } = setupCart()

    fake.seedPaymentSystems(orderFormId, [
      {
        id: 47,
        stringId: '47',
        name: 'Cash',
        groupName: 'cashPaymentGroup',
        requiresAuthentication: false,
      },
      {
        id: 2,
        stringId: '2',
        name: 'Visa',
        groupName: 'creditCardPaymentGroup',
        requiresAuthentication: true,
      },
    ])

    const methods = await cart.getAvailablePaymentSystems(orderFormId)

    assert.equal(methods.length, 2)
    assert.deepEqual(methods[0], {
      id: '47',
      name: 'Cash',
      group: 'cashPaymentGroup',
      requiresAuthentication: false,
    })
    assert.deepEqual(methods[1], {
      id: '2',
      name: 'Visa',
      group: 'creditCardPaymentGroup',
      requiresAuthentication: true,
    })
  })

  it('falls back to String(id) when stringId is absent', async () => {
    const { fake, cart, orderFormId } = setupCart()

    fake.seedPaymentSystems(orderFormId, [
      {
        id: 99,
        name: 'Generic',
        groupName: 'genericGroup',
      },
    ])

    const methods = await cart.getAvailablePaymentSystems(orderFormId)

    assert.equal(methods[0].id, '99')
  })

  it('filters out entries without a groupName', async () => {
    const { fake, cart, orderFormId } = setupCart()

    fake.seedPaymentSystems(orderFormId, [
      { id: 1, name: 'Broken', groupName: ('' as unknown) as string },
      {
        id: 47,
        stringId: '47',
        name: 'Cash',
        groupName: 'cashPaymentGroup',
      },
    ])

    const methods = await cart.getAvailablePaymentSystems(orderFormId)

    assert.equal(methods.length, 1)
    assert.equal(methods[0].id, '47')
  })

  it('returns an empty array when no payment systems are configured', async () => {
    const { cart, orderFormId } = setupCart()

    const methods = await cart.getAvailablePaymentSystems(orderFormId)

    assert.deepEqual(methods, [])
  })

  it('throws OrderFormSubstitutedError when VTEX swaps the id', async () => {
    const { fake, cart, orderFormId } = setupCart()

    fake.substituteNextOrderFormId('of-other')

    await assert.rejects(
      () => cart.getAvailablePaymentSystems(orderFormId),
      (err: Error) => {
        assert.ok(err instanceof OrderFormSubstitutedError)

        return true
      }
    )
  })
})

// ─── setPaymentData ─────────────────────────────────────────────────

describe('Cart.setPaymentData', () => {
  it('resolves paymentSystemName + group from configured systems when not provided', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1, 5000))
    seeded.value = 5000
    seeded.paymentData.paymentSystems = [
      {
        id: 47,
        stringId: '47',
        name: 'Cash',
        groupName: 'cashPaymentGroup',
      },
    ]
    fake.seed(seeded)

    const result = await cart.setPaymentData(orderFormId, {
      paymentSystemId: '47',
    })

    assert.equal(result.id, orderFormId)
    assert.equal(result.total, 50)
  })

  it('uses the provided value, installments, and skips lookup when name+group are passed', async () => {
    const { fake, cart, orderFormId } = setupCart()
    const seeded = makeEmptyOrderForm(orderFormId)

    seeded.items.push(makeItem('111', 1, 5000))
    seeded.value = 5000
    // No seeded systems — proves it didn't need them.
    fake.seed(seeded)

    const result = await cart.setPaymentData(orderFormId, {
      paymentSystemId: '47',
      paymentSystemName: 'Cash',
      group: 'cashPaymentGroup',
      installments: 3,
      value: 4000,
    })

    assert.ok(result)
    // Payment data was recorded on the orderForm.
    const stored = await fake.getOrderForm(orderFormId)
    const payments = stored.paymentData.payments as Array<
      Record<string, unknown>
    >

    assert.equal(payments.length, 1)
    assert.equal(payments[0].paymentSystem, '47')
    assert.equal(payments[0].value, 4000)
    assert.equal(payments[0].installments, 3)
    assert.equal(payments[0].referenceValue, 4000)
  })

  it('throws a clear error when paymentSystemId is not configured and lookup fails', async () => {
    const { cart, orderFormId } = setupCart()

    await assert.rejects(
      () =>
        cart.setPaymentData(orderFormId, {
          paymentSystemId: 'not-configured',
        }),
      /not configured/
    )
  })
})
