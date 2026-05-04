import React, { useState } from 'react'

import type { ProductCard } from './types'

interface ProductCardProps {
  product: ProductCard
  onAddToCart?: (sku: string, name: string) => void
}

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value / 100)
}

const CARD_STYLE: React.CSSProperties = {
  flex: '0 0 auto',
  width: '140px',
  display: 'flex',
  flexDirection: 'column',
  background: '#fff',
  border: '1px solid #e4e4e7',
  borderRadius: '10px',
  overflow: 'hidden',
  position: 'relative',
  textDecoration: 'none',
  color: 'inherit',
  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
}

const IMAGE_WRAP: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '1 / 1',
  background: '#f4f4f5',
  overflow: 'hidden',
}

const IMAGE_STYLE: React.CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
}

const DISCOUNT_BADGE: React.CSSProperties = {
  position: 'absolute',
  top: '6px',
  left: '6px',
  background: '#f71963',
  color: '#fff',
  fontSize: '11px',
  fontWeight: 700,
  padding: '3px 7px',
  borderRadius: '6px',
  letterSpacing: '0.02em',
}

const ADD_BTN_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '6px',
  right: '6px',
  width: '28px',
  height: '28px',
  border: 'none',
  borderRadius: '50%',
  background: '#f71963',
  color: '#fff',
  fontSize: '18px',
  fontWeight: 700,
  lineHeight: '28px',
  cursor: 'pointer',
  boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
}

const ADD_BTN_DONE: React.CSSProperties = {
  ...ADD_BTN_STYLE,
  background: '#22c55e',
  cursor: 'default',
}

const INFO_STYLE: React.CSSProperties = {
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  minHeight: '58px',
}

const NAME_STYLE: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 500,
  lineHeight: '1.25',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  color: '#18181b',
}

const PRICE_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '6px',
  marginTop: 'auto',
}

const PRICE_STYLE: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: '#f71963',
}

const LIST_PRICE_STYLE: React.CSSProperties = {
  fontSize: '11px',
  color: '#a1a1aa',
  textDecoration: 'line-through',
}

function ProductCardComponent({ product, onAddToCart }: ProductCardProps) {
  const [added, setAdded] = useState(false)
  const [adding, setAdding] = useState(false)
  const hasDiscount = product.listPrice && product.listPrice > product.price
  const discountPct = product.discountPct ?? (
    hasDiscount ? Math.round(((product.listPrice! - product.price) / product.listPrice!) * 100) : 0
  )

  const handleAddClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (added || adding || !onAddToCart) return
    setAdding(true)
    onAddToCart(product.productId, product.name)
    // UI optimism: show check for 2s
    setTimeout(() => {
      setAdding(false)
      setAdded(true)
      setTimeout(() => setAdded(false), 2500)
    }, 400)
  }

  return (
    <a href={product.url || '#'} style={CARD_STYLE} title={product.name}>
      <div style={IMAGE_WRAP}>
        {product.imageUrl && (
          <img style={IMAGE_STYLE} src={product.imageUrl} alt={product.name} loading="lazy" />
        )}
        {hasDiscount && discountPct > 0 && (
          <span style={DISCOUNT_BADGE}>-{discountPct}%</span>
        )}
        {onAddToCart && (
          <button
            onClick={handleAddClick}
            style={added ? ADD_BTN_DONE : ADD_BTN_STYLE}
            aria-label={added ? 'Adăugat' : 'Adaugă în coș'}
            type="button"
            disabled={adding || added}
          >
            {added ? '✓' : adding ? '…' : '+'}
          </button>
        )}
      </div>
      <div style={INFO_STYLE}>
        <span style={NAME_STYLE}>{product.name}</span>
        <div style={PRICE_ROW_STYLE}>
          <span style={PRICE_STYLE}>{formatPrice(product.price, product.currency)}</span>
          {hasDiscount && product.listPrice && (
            <span style={LIST_PRICE_STYLE}>
              {formatPrice(product.listPrice, product.currency)}
            </span>
          )}
        </div>
      </div>
    </a>
  )
}

export default ProductCardComponent
