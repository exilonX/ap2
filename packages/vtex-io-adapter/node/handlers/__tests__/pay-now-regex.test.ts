/**
 * Pay-Now gate regex mutual-exclusion tests.
 *
 * The widget checkout routes three distinct intercepts off body.message:
 *   - PILL_REGEX         → a payment-method pill was tapped (Phase A review)
 *   - PAY_NOW_REGEX      → the Pay-Now chip was tapped     (Phase B placement)
 *   - CONFIRMATION_REGEX → a plain "Da"/"Yes" add-to-cart confirmation
 *
 * If any representative string matched more than one of these, a single
 * user turn would fire two intercepts (or the wrong one) — e.g. a Pay-Now
 * tap getting misread as an add-to-cart confirmation. These tests import
 * the REAL regexes from the handler (so they cannot drift) and lock the
 * mutual-exclusion invariant on the exact strings the widget sends.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  CHECKOUT_INTENT_REGEX,
  CONFIRMATION_REGEX,
  PAY_NOW_REGEX,
  PILL_REGEX,
} from '../chat'

// Count how many of the three routing regexes match a given string.
function matchCount(s: string): number {
  let n = 0

  if (PILL_REGEX.test(s)) n++
  if (PAY_NOW_REGEX.test(s)) n++
  if (CONFIRMATION_REGEX.test(s)) n++

  return n
}

describe('Pay-Now gate regexes — mutual exclusion', () => {
  it('the payment pill turn matches ONLY PILL_REGEX', () => {
    const s = 'Plătesc cu Cash (id: 47)'

    assert.equal(PILL_REGEX.test(s), true, 'pill matches PILL')
    assert.equal(PAY_NOW_REGEX.test(s), false, 'pill does not match PAY_NOW')
    assert.equal(
      CONFIRMATION_REGEX.test(s),
      false,
      'pill does not match CONFIRMATION'
    )
    assert.equal(matchCount(s), 1)
  })

  it('the Pay-Now turn matches ONLY PAY_NOW_REGEX', () => {
    const s = 'Plătește acum'

    assert.equal(PAY_NOW_REGEX.test(s), true, 'pay-now matches PAY_NOW')
    assert.equal(PILL_REGEX.test(s), false, 'pay-now does not match PILL')
    assert.equal(
      CONFIRMATION_REGEX.test(s),
      false,
      'pay-now does not match CONFIRMATION'
    )
    assert.equal(matchCount(s), 1)
  })

  it('the __pay_now__ sentinel matches ONLY PAY_NOW_REGEX', () => {
    const s = '__pay_now__'

    assert.equal(PAY_NOW_REGEX.test(s), true)
    assert.equal(matchCount(s), 1)
  })

  it('an add-to-cart confirmation matches ONLY CONFIRMATION_REGEX', () => {
    for (const s of ['Da, adaugă', 'da', 'Yes', 'OK', 'adaugă']) {
      assert.equal(
        CONFIRMATION_REGEX.test(s),
        true,
        `"${s}" matches CONFIRMATION`
      )
      assert.equal(PILL_REGEX.test(s), false, `"${s}" does not match PILL`)
      assert.equal(
        PAY_NOW_REGEX.test(s),
        false,
        `"${s}" does not match PAY_NOW`
      )
      assert.equal(matchCount(s), 1, `"${s}" matches exactly one`)
    }
  })

  it('CHECKOUT_INTENT matches "go to payment" turns but NOT pill / Pay-Now / confirmation', () => {
    // Matches the cart button + free-typed checkout intents.
    for (const s of [
      'Mergem la plată',
      'la plată',
      'hai la checkout',
      'checkout',
      'gata, la plată',
    ]) {
      assert.equal(
        CHECKOUT_INTENT_REGEX.test(s),
        true,
        `"${s}" is checkout intent`
      )
    }

    // Must NOT collide with the deterministic checkout turns (those are
    // handled by tryPayNow BEFORE tryShowPaymentMethods runs).
    for (const s of [
      'Plătesc cu Cash (id: 47)',
      'Plătește acum',
      '__pay_now__',
      'Da, adaugă',
    ]) {
      assert.equal(
        CHECKOUT_INTENT_REGEX.test(s),
        false,
        `"${s}" must NOT be misread as checkout intent`
      )
    }
  })

  it('captures the paymentSystemId from the pill turn', () => {
    const m = PILL_REGEX.exec('Plătesc cu Cash on delivery (id: 47)')

    assert.ok(m)
    assert.equal(m![1], '47')
  })

  it('every representative checkout string routes to EXACTLY ONE regex (the expected one)', () => {
    const cases: Array<{ s: string; expect: 'pill' | 'paynow' | 'confirm' }> = [
      { s: 'Plătesc cu Cash (id: 47)', expect: 'pill' },
      { s: 'Plătesc cu Card (id: 6)', expect: 'pill' },
      { s: 'Plătesc cu Mastercard (id: 9)', expect: 'pill' },
      { s: 'Plătește acum', expect: 'paynow' },
      { s: 'plateste acum', expect: 'paynow' },
      { s: 'pay now', expect: 'paynow' },
      { s: '__pay_now__', expect: 'paynow' },
      { s: 'Da, adaugă', expect: 'confirm' },
      { s: 'da', expect: 'confirm' },
      { s: 'Yes', expect: 'confirm' },
      { s: 'OK', expect: 'confirm' },
    ]

    for (const { s, expect } of cases) {
      // Exactly one — not zero (a silent routing hole where a real widget turn
      // fires NO intercept) and not two (a collision). `<= 1` would miss the
      // zero case for the strings that have no dedicated positive assertion.
      assert.equal(matchCount(s), 1, `"${s}" must match exactly one regex`)
      assert.equal(PILL_REGEX.test(s), expect === 'pill', `"${s}" PILL`)
      assert.equal(PAY_NOW_REGEX.test(s), expect === 'paynow', `"${s}" PAY_NOW`)
      assert.equal(
        CONFIRMATION_REGEX.test(s),
        expect === 'confirm',
        `"${s}" CONFIRMATION`
      )
    }
  })
})
