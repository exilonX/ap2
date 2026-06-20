import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PaymentMethodOption } from '../../cart/cart'
import { curatePaymentMethods, reorderByPreference } from '../payment-methods'

// Mirrors the noisy real-store list from the screenshot (order/casing kept).
const mk = (id: string, name: string, group: string): PaymentMethodOption => ({
  id,
  name,
  group,
  requiresAuthentication: group === 'creditCardPaymentGroup',
})

const STORE: PaymentMethodOption[] = [
  mk('1', 'PayPal', 'p'),
  mk('2', 'AmazonPay', 'p'),
  mk('3', 'Mollie', 'p'),
  mk('4', 'Scalapay', 'p'),
  mk('5', 'Oney', 'p'),
  mk('6', 'IngRO', 'p'),
  mk('7', 'Visa Electron', 'creditCardPaymentGroup'),
  mk('8', 'Apple Pay', 'p'),
  mk('9', 'Mastercard', 'creditCardPaymentGroup'),
  mk('47', 'Cash', 'cashPaymentGroup'),
  mk('10', 'Visa', 'creditCardPaymentGroup'),
]

describe('curatePaymentMethods — allowlist', () => {
  it('filters to ONLY the allowlisted methods, in the allowlist order, matching by name (case-insensitive)', () => {
    const out = curatePaymentMethods(STORE, {
      allowedPaymentMethods: ['Cash', 'Visa', 'Mastercard', 'PayPal', 'IngRo'],
    })

    assert.deepEqual(
      out.map((m) => m.name),
      ['Cash', 'Visa', 'Mastercard', 'PayPal', 'IngRO']
    )
  })

  it('matches "IngRo" against the store\'s "IngRO" (case-insensitive name)', () => {
    const out = curatePaymentMethods(STORE, {
      allowedPaymentMethods: ['IngRo'],
    })

    assert.deepEqual(
      out.map((m) => m.id),
      ['6']
    )
  })

  it('matches by id when the allowlist entry is an id', () => {
    const out = curatePaymentMethods(STORE, {
      allowedPaymentMethods: ['47', 'Visa'],
    })

    assert.deepEqual(
      out.map((m) => m.name),
      ['Cash', 'Visa']
    )
  })

  it('silently skips allowlist entries that match no configured method', () => {
    const out = curatePaymentMethods(STORE, {
      allowedPaymentMethods: ['Cash', 'Bitcoin', 'Visa'],
    })

    assert.deepEqual(
      out.map((m) => m.name),
      ['Cash', 'Visa']
    )
  })

  it('never emits the same method twice even if listed twice', () => {
    const out = curatePaymentMethods(STORE, {
      allowedPaymentMethods: ['Cash', 'cash', '47'],
    })

    assert.equal(out.length, 1)
    assert.equal(out[0].name, 'Cash')
  })

  it('allowlist wins over preferredPaymentMethods (filter, not just reorder)', () => {
    const out = curatePaymentMethods(STORE, {
      allowedPaymentMethods: ['Cash', 'Visa'],
      preferredPaymentMethods: ['1'], // PayPal — must NOT leak in
    })

    assert.deepEqual(
      out.map((m) => m.name),
      ['Cash', 'Visa']
    )
  })
})

describe('curatePaymentMethods — no allowlist', () => {
  it('returns every method, reordered by preferredPaymentMethods', () => {
    const out = curatePaymentMethods(STORE, {
      preferredPaymentMethods: ['47', '10'],
    })

    assert.equal(out.length, STORE.length, 'nothing filtered out')
    assert.deepEqual(
      out.slice(0, 2).map((m) => m.name),
      ['Cash', 'Visa']
    )
  })

  it('returns the list unchanged when neither allowlist nor preference is set', () => {
    const out = curatePaymentMethods(STORE, {})

    assert.deepEqual(out, STORE)
  })

  it('treats an empty allowlist as "no allowlist" (shows all)', () => {
    const out = curatePaymentMethods(STORE, { allowedPaymentMethods: [] })

    assert.equal(out.length, STORE.length)
  })
})

describe('reorderByPreference', () => {
  it('bubbles preferred ids to the top in preference order, keeps the rest', () => {
    const out = reorderByPreference(STORE, ['10', '47'])

    assert.deepEqual(
      out.slice(0, 2).map((m) => m.name),
      ['Visa', 'Cash']
    )
    assert.equal(out.length, STORE.length)
  })

  it('is a no-op for an empty preference list', () => {
    assert.deepEqual(reorderByPreference(STORE), STORE)
  })
})
