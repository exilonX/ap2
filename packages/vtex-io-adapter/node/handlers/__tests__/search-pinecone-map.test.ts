/**
 * pineconeMatchToProduct tests.
 *
 * Locks the Pinecone-metadata → SimpleProduct mapping that backs the
 * Pinecone-first path in `searchProducts` (Fix B). The metadata shape is
 * whatever `scripts/sync-catalog/sync.ts:toProductMetadata` emits — these
 * tests use that contract as the fixture.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { pineconeMatchToProduct } from '../search'
import type { PineconeMatch } from '../../clients/pinecone'

function makeMatch(metadata: Record<string, unknown>): PineconeMatch {
  return {
    id: metadata.sku ? String(metadata.sku) : 'sku-fallback',
    score: 0.6,
    metadata,
  }
}

describe('pineconeMatchToProduct', () => {
  it('maps a fully-populated sync-catalog match into a SimpleProduct', () => {
    const product = pineconeMatchToProduct(
      makeMatch({
        sku: '1',
        productId: '1',
        name: 'ROCHITA',
        linkText: 'rochita',
        price: 0.08,
        originalPrice: 0.1,
        discountPct: 20,
        onSale: true,
        image: 'https://example.com/rochita.jpg',
        category: '/Hogar/Cocina/Neveras/',
        brand: 'Test Brand',
        available: true,
      })
    )

    assert.equal(product.sku, '1')
    assert.equal(product.name, 'ROCHITA')
    assert.equal(product.price, 0.08)
    assert.equal(product.originalPrice, 0.1)
    assert.equal(product.image, 'https://example.com/rochita.jpg')
    assert.equal(product.brand, 'Test Brand')
    assert.equal(product.available, true)
    // Category gets the slashes-to-arrows treatment that mirrors mapProduct.
    assert.equal(product.category, 'Hogar > Cocina > Neveras')
  })

  it('omits originalPrice when it is not higher than price', () => {
    const product = pineconeMatchToProduct(
      makeMatch({ sku: '2', name: 'No discount', price: 50, originalPrice: 50 })
    )

    assert.equal(product.originalPrice, undefined)
  })

  it('treats missing available flag as available=true (conservative)', () => {
    const product = pineconeMatchToProduct(
      makeMatch({ sku: '3', name: 'Unknown stock', price: 10 })
    )

    assert.equal(product.available, true)
  })

  it('respects an explicit available=false', () => {
    const product = pineconeMatchToProduct(
      makeMatch({ sku: '4', name: 'OOS', price: 10, available: false })
    )

    assert.equal(product.available, false)
  })

  it('falls back to match.id when metadata.sku is absent', () => {
    const product = pineconeMatchToProduct({
      id: 'fallback-id',
      score: 0.5,
      metadata: { name: 'No SKU in metadata' },
    })

    assert.equal(product.sku, 'fallback-id')
  })

  it('returns category as undefined when none is present (not "undefined" string)', () => {
    const product = pineconeMatchToProduct(
      makeMatch({ sku: '5', name: 'No category', price: 10 })
    )

    assert.equal(product.category, undefined)
  })

  it('keeps numeric prices as numbers even when metadata stores them as strings', () => {
    const product = pineconeMatchToProduct(
      makeMatch({
        sku: '6',
        name: 'Stringy price',
        price: '12.34',
        originalPrice: '15',
      })
    )

    assert.equal(product.price, 12.34)
    assert.equal(product.originalPrice, 15)
  })
})
