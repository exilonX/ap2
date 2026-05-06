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
  marginBottom: '8px',
}

const LINK_ROW: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
  marginTop: '4px',
}

const LINK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '6px 10px',
  background: '#fff',
  border: '1px solid #c8e6c9',
  borderRadius: '8px',
  color: '#2e7d32',
  fontSize: '12px',
  fontWeight: 500,
  textDecoration: 'none',
}

function shortDid(did: string): string {
  // did:web:acg--miniprix.myvtex.com → acg--miniprix.myvtex.com
  return did.replace(/^did:web:/, '')
}

function MandateBadge({ mandate }: MandateBadgeProps) {
  return (
    <div style={CARD_STYLE} role="note" aria-label="Cryptographically signed cart mandate">
      <div style={HEADER_ROW}>
        <span style={CHECK_DOT} aria-hidden="true">✓</span>
        <span>Cryptographically signed by {shortDid(mandate.signedBy)}</span>
      </div>
      <div style={META_ROW}>{mandate.mandateId}</div>
      <div style={LINK_ROW}>
        <a
          href={mandate.retrievalUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={LINK_STYLE}
        >
          View mandate proof →
        </a>
        <a
          href={mandate.didDocumentUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={LINK_STYLE}
        >
          Verify merchant identity →
        </a>
      </div>
    </div>
  )
}

export default MandateBadge
