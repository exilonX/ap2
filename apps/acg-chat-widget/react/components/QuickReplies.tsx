import React from 'react'

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
  border: '1px solid #f71963',
  background: '#fff',
  color: '#f71963',
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
            e.currentTarget.style.background = '#f71963'
            e.currentTarget.style.color = '#fff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#fff'
            e.currentTarget.style.color = '#f71963'
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
