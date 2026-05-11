import React from 'react'

import type { CartPreview } from './types'

interface CartPreviewCardProps {
  cart: CartPreview
}

function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

const WRAPPER: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e4e4e7',
  borderRadius: '12px',
  padding: '14px',
  marginTop: '8px',
  maxWidth: '420px',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
}

const HEADER: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '10px',
  paddingBottom: '8px',
  borderBottom: '1px solid #f4f4f5',
}

const HEADER_TITLE: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: '#18181b',
}

const ITEM_COUNT: React.CSSProperties = {
  fontSize: '11px',
  color: '#71717a',
  background: '#f4f4f5',
  padding: '2px 8px',
  borderRadius: '10px',
}

const ITEMS_WRAP: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  maxHeight: '240px',
  overflowY: 'auto',
}

const ITEM_ROW: React.CSSProperties = {
  display: 'flex',
  gap: '10px',
  alignItems: 'center',
}

const ITEM_IMG: React.CSSProperties = {
  width: '40px',
  height: '40px',
  objectFit: 'cover',
  borderRadius: '6px',
  background: '#f4f4f5',
  flexShrink: 0,
}

const ITEM_INFO: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
}

const ITEM_NAME: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 500,
  color: '#18181b',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const ITEM_META: React.CSSProperties = {
  fontSize: '11px',
  color: '#71717a',
  marginTop: '2px',
}

const ITEM_PRICE: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#18181b',
  marginLeft: '8px',
  whiteSpace: 'nowrap',
}

const TOTALS: React.CSSProperties = {
  marginTop: '10px',
  paddingTop: '10px',
  borderTop: '1px solid #f4f4f5',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const TOTAL_LABEL: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#18181b',
}

const TOTAL_AMOUNT: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 700,
  color: '#f71963',
}

function CartPreviewCard({ cart }: CartPreviewCardProps) {
  return (
    <div style={WRAPPER}>
      <div style={HEADER}>
        <span style={HEADER_TITLE}>Coșul tău</span>
        <span style={ITEM_COUNT}>{cart.itemCount} {cart.itemCount === 1 ? 'articol' : 'articole'}</span>
      </div>

      <div style={ITEMS_WRAP}>
        {cart.items.map((item) => (
          <div key={item.sku} style={ITEM_ROW}>
            {item.image ? (
              <img src={item.image} alt={item.name} style={ITEM_IMG} loading="lazy" />
            ) : (
              <div style={ITEM_IMG} />
            )}
            <div style={ITEM_INFO}>
              <span style={ITEM_NAME}>{item.name}</span>
              <span style={ITEM_META}>
                {item.quantity} × {formatPrice(item.unitPrice, cart.currency)}
              </span>
            </div>
            <span style={ITEM_PRICE}>{formatPrice(item.totalPrice, cart.currency)}</span>
          </div>
        ))}
      </div>

      <div style={TOTALS}>
        <span style={TOTAL_LABEL}>Total</span>
        <span style={TOTAL_AMOUNT}>{formatPrice(cart.total, cart.currency)}</span>
      </div>

      {/*
        The inline "Mergi la plată" button was removed deliberately.
        Two-button confusion: the cart preview used to navigate directly
        to VTEX native checkout, bypassing the AP2 mandate signing
        entirely. The mandate badge below handles the full ceremony
        (sign → pay in chat → receipt), and exposes a "Or use VTEX
        standard checkout" secondary link as the explicit
        no-AP2 escape hatch. One path per intent.
      */}
    </div>
  )
}

export default CartPreviewCard
