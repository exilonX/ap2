import React, { useState } from 'react'

import type { ProductCard } from '../types/domain'
import { formatCurrencyCents } from '../utils/format-price'
import {
  ACCENT_PINK,
  GRAY_BORDER,
  GRAY_MUTED,
  GRAY_SURFACE,
  GRAY_TEXT,
  SHADOW_BUTTON,
  SUCCESS_GREEN,
  WHITE,
} from '../utils/theme'

interface ProductCardProps {
  product: ProductCard
  onAddToCart?: (sku: string, name: string) => void
}

const CARD_STYLE: React.CSSProperties = {
  flex: '0 0 auto',
  width: '140px',
  display: 'flex',
  flexDirection: 'column',
  background: WHITE,
  border: `1px solid ${GRAY_BORDER}`,
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
  background: GRAY_SURFACE,
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
  background: ACCENT_PINK,
  color: WHITE,
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
  background: ACCENT_PINK,
  color: WHITE,
  fontSize: '18px',
  fontWeight: 700,
  lineHeight: '28px',
  cursor: 'pointer',
  boxShadow: SHADOW_BUTTON,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
}

const ADD_BTN_DONE: React.CSSProperties = {
  ...ADD_BTN_STYLE,
  background: SUCCESS_GREEN,
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
  color: GRAY_TEXT,
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
  color: ACCENT_PINK,
}

const LIST_PRICE_STYLE: React.CSSProperties = {
  fontSize: '11px',
  color: GRAY_MUTED,
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
          <span style={PRICE_STYLE}>{formatCurrencyCents(product.price, product.currency)}</span>
          {hasDiscount && product.listPrice && (
            <span style={LIST_PRICE_STYLE}>
              {formatCurrencyCents(product.listPrice, product.currency)}
            </span>
          )}
        </div>
      </div>
    </a>
  )
}

export default ProductCardComponent
