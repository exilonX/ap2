import React from 'react'

import type { PaymentMethod } from '../types/domain'
import { ACCENT_PINK, WHITE } from '../utils/theme'

interface PaymentMethodPillsProps {
  methods: PaymentMethod[]
  onSelect: (text: string) => void
}

const WRAPPER: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  marginTop: '8px',
}

const PILL: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '13px',
  padding: '8px 14px',
  borderRadius: '999px',
  border: `1.5px solid ${ACCENT_PINK}`,
  background: WHITE,
  color: ACCENT_PINK,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 600,
  transition: 'background 0.15s ease, color 0.15s ease',
  whiteSpace: 'nowrap',
}

// Per-group icon glyph. Stays as plain unicode (no emoji) so per-merchant
// `brand.tone` neutral profiles render the same as casual ones.
const GROUP_ICON: Record<string, string> = {
  cashPaymentGroup: '$',
  creditCardPaymentGroup: '#',
  debitCardPaymentGroup: '#',
  bankInvoicePaymentGroup: '§',
  payPalPaymentGroup: 'P',
}

function PaymentMethodPills({ methods, onSelect }: PaymentMethodPillsProps) {
  if (methods.length === 0) return null

  return (
    <div style={WRAPPER}>
      {methods.map((m) => {
        const icon = m.group ? GROUP_ICON[m.group] ?? '◯' : '◯'
        // Canned turn the LLM routes through set_payment_method —
        // includes id so the model doesn't have to guess across name
        // collisions (Visa Electron vs Visa, etc.).
        const cannedTurn = `Plătesc cu ${m.name} (id: ${m.id})`

        return (
          <button
            key={m.id}
            style={PILL}
            onClick={() => onSelect(cannedTurn)}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = ACCENT_PINK
              e.currentTarget.style.color = WHITE
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = WHITE
              e.currentTarget.style.color = ACCENT_PINK
            }}
            type="button"
          >
            <span aria-hidden="true">{icon}</span>
            <span>{m.name}</span>
          </button>
        )
      })}
    </div>
  )
}

export default PaymentMethodPills
