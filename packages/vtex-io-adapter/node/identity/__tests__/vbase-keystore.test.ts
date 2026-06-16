/**
 * VBaseKeyStore contract tests.
 *
 * Covers:
 *   - read returns null when no key has been written
 *   - read returns the StoredKeys object after a write
 *   - default bucket/key match the legacy did.ts handler
 *   - custom bucket/key works
 *   - signed mandates verify across a save+reload via the store
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { VBaseKeyStore } from '../vbase-keystore'
import { FakeVBase } from './fake-vbase'
import {
  loadOrCreateIdentity,
  createCartMandate,
  verifyCartMandate,
} from '../../core'

describe('VBaseKeyStore', () => {
  it('returns null when no key has been written', async () => {
    const fake = new FakeVBase()
    const store = new VBaseKeyStore(fake)
    const result = await store.read()

    assert.equal(result, null)
  })

  it('reads back what it wrote', async () => {
    const fake = new FakeVBase()
    const store = new VBaseKeyStore(fake)
    const stored = {
      publicKeyHex: 'aa',
      privateKeyHex: 'bb',
      domain: 'vbase.example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    await store.write(stored)
    const result = await store.read()

    assert.deepEqual(result, stored)
  })

  it('uses default bucket "acg-identity" and key "merchant-did"', async () => {
    const fake = new FakeVBase()
    const store = new VBaseKeyStore(fake)
    const stored = {
      publicKeyHex: 'aa',
      privateKeyHex: 'bb',
      domain: 'vbase.example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    await store.write(stored)

    // Verify the key landed at the legacy location
    const peek = fake.peek('acg-identity', 'merchant-did')

    assert.deepEqual(peek, stored)
  })

  it('honours custom bucket and key names', async () => {
    const fake = new FakeVBase()
    const store = new VBaseKeyStore(fake, 'my-bucket', 'my-key')
    const stored = {
      publicKeyHex: 'aa',
      privateKeyHex: 'bb',
      domain: 'vbase.example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    await store.write(stored)

    assert.equal(fake.peek('acg-identity', 'merchant-did'), null)
    assert.deepEqual(fake.peek('my-bucket', 'my-key'), stored)
  })

  it('picks up keys seeded in the legacy bucket without migration', async () => {
    const fake = new FakeVBase()

    fake.seed('acg-identity', 'merchant-did', {
      publicKeyHex: 'cc',
      privateKeyHex: 'dd',
      domain: 'legacy.example.com',
      createdAt: '2025-12-01T00:00:00.000Z',
    })

    const store = new VBaseKeyStore(fake)
    const result = await store.read()

    assert.ok(result)
    assert.equal(result!.publicKeyHex, 'cc')
    assert.equal(result!.domain, 'legacy.example.com')
  })

  it('mandates signed via VBaseKeyStore verify after a process restart', async () => {
    const fake = new FakeVBase()

    // First "boot": create identity, sign a mandate.
    const store1 = new VBaseKeyStore(fake)
    const id1 = await loadOrCreateIdentity('roundtrip.example.com', store1)
    const mandate = await createCartMandate(
      {
        items: [{ sku: '1', name: 'Item', quantity: 1, unitPrice: 10 }],
        totalAmount: 10,
        currency: 'RON',
        orderFormId: 'of-rt',
      },
      id1.domain,
      id1.keys
    )

    // Second "boot": fresh store instance over the same VBase contents.
    const store2 = new VBaseKeyStore(fake)
    const id2 = await loadOrCreateIdentity('roundtrip.example.com', store2)
    const result = await verifyCartMandate(mandate, id2.keys.publicKey)

    assert.equal(result.valid, true)
  })
})
