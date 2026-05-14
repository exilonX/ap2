import React from 'react'

import { ACCENT_PINK, WHITE } from '../utils/theme'

interface QuickRepliesProps {
  suggestions: string[]
  onSelect: (text: string) => void
}

const WRAPPER: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  marginTop: '4px',
}

const CHIP: React.CSSProperties = {
  fontSize: '13px',
  padding: '7px 12px',
  borderRadius: '999px',
  border: `1px solid ${ACCENT_PINK}`,
  background: WHITE,
  color: ACCENT_PINK,
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontWeight: 500,
  transition: 'background 0.15s ease, color 0.15s ease',
  whiteSpace: 'nowrap',
}

function QuickReplies({ suggestions, onSelect }: QuickRepliesProps) {
  if (suggestions.length === 0) return null

  return (
    <div style={WRAPPER}>
      {suggestions.map((text) => (
        <button
          key={text}
          style={CHIP}
          onClick={() => onSelect(text)}
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
          {text}
        </button>
      ))}
    </div>
  )
}

export default QuickReplies
