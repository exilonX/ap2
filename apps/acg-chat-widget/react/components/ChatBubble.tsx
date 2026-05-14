import React from 'react'

interface ChatBubbleProps {
  isOpen: boolean
  hasUnread: boolean
  onClick: () => void
}

const BUBBLE_STYLE: React.CSSProperties = {
  width: '60px',
  height: '60px',
  borderRadius: '50%',
  background: '#f71963',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2)',
  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
  position: 'relative' as const,
}

const BUBBLE_OPEN_STYLE: React.CSSProperties = {
  ...BUBBLE_STYLE,
  background: '#3f3f46',
}

const UNREAD_STYLE: React.CSSProperties = {
  position: 'absolute',
  top: '-2px',
  right: '-2px',
  width: '16px',
  height: '16px',
  background: '#ef4444',
  borderRadius: '50%',
  border: '2px solid #fff',
}

function ChatBubble({ isOpen, hasUnread, onClick }: ChatBubbleProps) {
  return (
    <button
      style={isOpen ? BUBBLE_OPEN_STYLE : BUBBLE_STYLE}
      onClick={onClick}
      aria-label={isOpen ? 'Close chat' : 'Open chat'}
      type="button"
    >
      {isOpen ? (
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      ) : (
        <>
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {hasUnread && <span style={UNREAD_STYLE} />}
        </>
      )}
    </button>
  )
}

export default ChatBubble
