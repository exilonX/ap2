import React, { useState } from 'react'

import type { OrderReview } from '../types/domain'
import { formatCurrencyCents } from '../utils/format-price'
import {
  ACCENT_PINK,
  GRAY_BORDER,
  GRAY_DIM,
  GRAY_SURFACE,
  GRAY_TEXT,
  SHADOW_SOFT,
  WHITE,
} from '../utils/theme'

interface OrderReviewCardProps {
  review: OrderReview
  onPayNow: (text: string) => void
  /**
   * Only the review attached to the LATEST assistant message gets a live
   * Pay-Now button. Older review cards (the customer tapped a second payment
   * pill) are shown read-only so they can't place against a cart state that
   * has since changed. Defaults to true for standalone use.
   */
  isLatest?: boolean
}

// Sentinel the backend's tryPayNow Phase B intercepts (PAY_NOW_REGEX in the
// adapter's chat handler). Must stay in exact sync with that regex.
const PAY_NOW_SENTINEL = 'Plătește acum'

const WRAPPER: React.CSSProperties = {
  background: WHITE,
  border: `1px solid ${GRAY_BORDER}`,
  borderRadius: '12px',
  padding: '14px',
  marginTop: '8px',
  maxWidth: '420px',
  boxShadow: SHADOW_SOFT,
}

const HEADER_TITLE: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 700,
  color: GRAY_TEXT,
  marginBottom: '10px',
  paddingBottom: '8px',
  borderBottom: `1px solid ${GRAY_SURFACE}`,
}

const SECTION: React.CSSProperties = {
  marginBottom: '10px',
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: GRAY_DIM,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: '3px',
}

const SECTION_VALUE: React.CSSProperties = {
  fontSize: '13px',
  color: GRAY_TEXT,
  lineHeight: 1.4,
}

const SUBTLE: React.CSSProperties = {
  fontSize: '12px',
  color: GRAY_DIM,
}

const TOTALS: React.CSSProperties = {
  marginTop: '10px',
  paddingTop: '10px',
  borderTop: `1px solid ${GRAY_SURFACE}`,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

const TOTAL_LABEL: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: GRAY_TEXT,
}

const TOTAL_AMOUNT: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 700,
  color: ACCENT_PINK,
}

const PAY_BTN: React.CSSProperties = {
  marginTop: '12px',
  width: '100%',
  padding: '11px 14px',
  borderRadius: '10px',
  border: 'none',
  background: ACCENT_PINK,
  color: WHITE,
  fontSize: '14px',
  fontWeight: 700,
  fontFamily: 'inherit',
  cursor: 'pointer',
}

const PAY_BTN_DISABLED: React.CSSProperties = {
  ...PAY_BTN,
  opacity: 0.55,
  cursor: 'default',
}

function OrderReviewCard({
  review,
  onPayNow,
  isLatest = true,
}: OrderReviewCardProps) {
  const profile = review.customerProfile
  const hasProfile =
    !!profile &&
    !!(profile.name || profile.email || profile.phone || profile.document)

  // Send the Pay-Now sentinel at most once per card. The server lock is
  // per-replica, so the client must own this debounce (a double-click can
  // otherwise place twice across replicas). Disabled too on non-latest cards.
  const [submitted, setSubmitted] = useState(false)
  const disabled = submitted || !isLatest

  const handlePay = () => {
    if (disabled) return
    setSubmitted(true)
    onPayNow(PAY_NOW_SENTINEL)
  }

  return (
    <div style={WRAPPER}>
      <div style={HEADER_TITLE}>Confirmă comanda</div>

      {hasProfile && profile && (
        <div style={SECTION}>
          <div style={SECTION_LABEL}>Client</div>
          {profile.name && <div style={SECTION_VALUE}>{profile.name}</div>}
          {profile.email && <div style={SUBTLE}>{profile.email}</div>}
          {profile.phone && <div style={SUBTLE}>{profile.phone}</div>}
          {profile.document && <div style={SUBTLE}>{profile.document}</div>}
        </div>
      )}

      {review.shippingAddress && (
        <div style={SECTION}>
          <div style={SECTION_LABEL}>Livrare</div>
          <div style={SECTION_VALUE}>{review.shippingAddress}</div>
        </div>
      )}

      {review.selectedPayment && (
        <div style={SECTION}>
          <div style={SECTION_LABEL}>Plată</div>
          <div style={SECTION_VALUE}>{review.selectedPayment.name}</div>
        </div>
      )}

      <div style={TOTALS}>
        <span style={TOTAL_LABEL}>Total</span>
        <span style={TOTAL_AMOUNT}>
          {formatCurrencyCents(review.total, review.currency)}
        </span>
      </div>

      <button
        type="button"
        style={disabled ? PAY_BTN_DISABLED : PAY_BTN}
        onClick={handlePay}
        disabled={disabled}
      >
        {submitted ? 'Se procesează…' : 'Plătește acum'}
      </button>
    </div>
  )
}

export default OrderReviewCard
