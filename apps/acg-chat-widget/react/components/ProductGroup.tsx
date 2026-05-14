import React from 'react'

import type { ProductCard } from '../types/domain'
import ProductCardComponent from './ProductCard'

interface ProductGroupProps {
  products: ProductCard[]
  onAddToCart: (sku: string, name: string) => void
}

/**
 * Groups products by their `groupLabel` and renders each group as a
 * horizontal scrolling row with a header. Ungrouped products go under "Rezultate".
 */
function ProductGroup({ products, onAddToCart }: ProductGroupProps) {
  if (products.length === 0) return null

  // Group products by groupLabel (preserve insertion order)
  const groups = new Map<string, ProductCard[]>()

  for (const p of products) {
    const key = p.groupLabel || 'Rezultate'

    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(p)
  }

  return (
    <div style={WRAPPER_STYLE}>
      {[...groups.entries()].map(([label, items]) => (
        <div key={label} style={GROUP_STYLE}>
          {groups.size > 1 && (
            <div style={LABEL_STYLE}>
              {label.charAt(0).toUpperCase() + label.slice(1)}{' '}
              <span style={COUNT_STYLE}>· {items.length}</span>
            </div>
          )}
          <div style={SCROLLER_STYLE}>
            {items.map((p) => (
              <ProductCardComponent
                key={p.productId}
                product={p}
                onAddToCart={onAddToCart}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const WRAPPER_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
  marginTop: '8px',
}

const GROUP_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#52525b',
  textTransform: 'capitalize',
  paddingLeft: '2px',
}

const COUNT_STYLE: React.CSSProperties = {
  color: '#a1a1aa',
  fontWeight: 400,
}

const SCROLLER_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  overflowX: 'auto',
  overflowY: 'hidden',
  paddingBottom: '4px',
  scrollbarWidth: 'thin',
}

export default ProductGroup
