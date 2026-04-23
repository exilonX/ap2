import React from 'react'

import type { ProductCard } from './types'

interface ProductCardProps {
  product: ProductCard
}

function formatPrice(value: number, currency: string): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency,
  }).format(value / 100)
}

const CARD_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  padding: '10px',
  marginTop: '8px',
  background: '#fff',
  border: '1px solid #e4e4e7',
  borderRadius: '10px',
  textDecoration: 'none',
  color: 'inherit',
}

const IMAGE_STYLE: React.CSSProperties = {
  width: '56px',
  height: '56px',
  borderRadius: '8px',
  objectFit: 'cover',
  flexShrink: 0,
}

const INFO_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  minWidth: 0,
}

const NAME_STYLE: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 500,
  lineHeight: '1.3',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const PRICE_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '2px',
}

const PRICE_STYLE: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#f71963',
}

const LIST_PRICE_STYLE: React.CSSProperties = {
  fontSize: '12px',
  color: '#a1a1aa',
  textDecoration: 'line-through',
}

function ProductCardComponent({ product }: ProductCardProps) {
  const hasDiscount = product.listPrice && product.listPrice > product.price

  return (
    <a
      href={product.url}
      style={CARD_STYLE}
      target="_blank"
      rel="noopener noreferrer"
    >
      <img
        style={IMAGE_STYLE}
        src={product.imageUrl}
        alt={product.name}
        loading="lazy"
      />
      <div style={INFO_STYLE}>
        <span style={NAME_STYLE}>{product.name}</span>
        <div style={PRICE_ROW_STYLE}>
          <span style={PRICE_STYLE}>
            {formatPrice(product.price, product.currency)}
          </span>
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
