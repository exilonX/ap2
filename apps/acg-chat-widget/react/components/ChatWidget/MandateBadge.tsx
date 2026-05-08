import React from 'react'

import type { Mandate } from './types'

interface MandateBadgeProps {
  mandate: Mandate
}

const CARD_STYLE: React.CSSProperties = {
  marginTop: '4px',
  padding: '12px 14px',
  background: 'linear-gradient(180deg, #f5fbf6 0%, #ecf7ee 100%)',
  border: '1px solid #c8e6c9',
  borderRadius: '12px',
  fontSize: '13px',
  lineHeight: '1.5',
  color: '#1b5e20',
}

const HEADER_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontWeight: 600,
  marginBottom: '6px',
}

const CHECK_DOT: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  background: '#2e7d32',
  color: '#fff',
  fontSize: '13px',
  fontWeight: 700,
  flexShrink: 0,
}

const META_ROW: React.CSSProperties = {
  fontSize: '11px',
  color: '#33691e',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  wordBreak: 'break-all',
  marginBottom: '10px',
}

// Primary CTA: styled as a filled button that visually dominates the badge.
// Same-tab navigation (no target=_blank) — the user is committing to checkout,
// the cookie-bound orderForm session carries the cart over to VTEX native.
const PRIMARY_CTA_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  padding: '10px 14px',
  background: 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)',
  color: '#fff',
  fontWeight: 600,
  fontSize: '13px',
  borderRadius: '10px',
  textDecoration: 'none',
  marginBottom: '8px',
}

// Secondary audit links: small, underlined, separated by a middot.
// These are the "anyone can verify this" affordances — present but not
// competing with the action button.
const AUDIT_ROW: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
}

const AUDIT_LINK: React.CSSProperties = {
  color: '#2e7d32',
  textDecoration: 'underline',
}

const AUDIT_SEP: React.CSSProperties = {
  color: '#9ccc9c',
}

function shortDid(did: string): string {
  // did:web:acg--miniprix.myvtex.com → acg--miniprix.myvtex.com
  return did.replace(/^did:web:/, '')
}

function formatPrice(total: number, currency: string): string {
  // total is in major units (RON, EUR), not cents — matches how snapshot.total
  // flows from the cart snapshot. Intl.NumberFormat handles locale separators
  // and currency symbol placement.
  try {
    return new Intl.NumberFormat('ro-RO', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(total)
  } catch {
    // Defensive: unknown currency code falls back to plain "84.80 RON" format.
    return `${total.toFixed(2)} ${currency}`
  }
}

function MandateBadge({ mandate }: MandateBadgeProps) {
  return (
    <div style={CARD_STYLE} role="note" aria-label="Cryptographically signed cart mandate">
      <div style={HEADER_ROW}>
        <span style={CHECK_DOT} aria-hidden="true">✓</span>
        <span>Cryptographically signed by {shortDid(mandate.signedBy)}</span>
      </div>
      <div style={META_ROW}>{mandate.mandateId}</div>
      {/* Primary CTA — same-tab handoff to VTEX native checkout. */}
      {/* TODO(0014): lift the Romanian button text to profile.strings for proper i18n. */}
      <a href={mandate.checkoutUrl} style={PRIMARY_CTA_STYLE}>
        Finalizează comanda — {formatPrice(mandate.total, mandate.currency)} →
      </a>
      <div style={AUDIT_ROW}>
        <a
          href={mandate.retrievalUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={AUDIT_LINK}
        >
          View mandate proof →
        </a>
        <span style={AUDIT_SEP}>·</span>
        <a
          href={mandate.didDocumentUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={AUDIT_LINK}
        >
          Verify merchant identity →
        </a>
      </div>
    </div>
  )
}

export default MandateBadge
