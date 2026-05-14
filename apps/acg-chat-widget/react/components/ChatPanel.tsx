import React from 'react'

import type { Message } from '../types/domain'
import MessageList from './MessageList'
import ChatInput from './ChatInput'

interface ChatPanelProps {
  isOpen: boolean
  messages: Message[]
  isTyping: boolean
  onSend: (text: string) => void
  onAddToCart: (sku: string, name: string) => void
  onQuickReply: (text: string) => void
  onClear: () => void
  placeholder?: string
  headerTitle?: string
  headerStatus?: string
  resetLabel?: string
  resetConfirm?: string
  poweredBy?: string
  accentColor?: string
}

const PANEL_BASE: React.CSSProperties = {
  position: 'absolute',
  bottom: '72px',
  right: '0',
  width: '880px',
  maxWidth: 'calc(100vw - 40px)',
  height: '800px',
  maxHeight: 'calc(100vh - 120px)',
  background: '#fff',
  borderRadius: '16px',
  boxShadow: '0 8px 40px rgba(0, 0, 0, 0.15)',
  display: 'flex',
  flexDirection: 'column' as const,
  overflow: 'hidden',
  opacity: 0,
  transform: 'translateY(16px) scale(0.95)',
  pointerEvents: 'none' as const,
  transition: 'opacity 0.25s ease, transform 0.25s ease',
}

const PANEL_OPEN: React.CSSProperties = {
  ...PANEL_BASE,
  opacity: 1,
  transform: 'translateY(0) scale(1)',
  pointerEvents: 'auto' as const,
}

const TITLE_STYLE: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  lineHeight: '1.3',
}

const STATUS_STYLE: React.CSSProperties = {
  fontSize: '12px',
  opacity: 0.9,
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '2px',
}

const STATUS_DOT: React.CSSProperties = {
  width: '8px',
  height: '8px',
  background: '#4ade80',
  borderRadius: '50%',
  display: 'inline-block',
}

const BODY_STYLE: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
}

const POWERED_STYLE: React.CSSProperties = {
  textAlign: 'center',
  fontSize: '10px',
  color: '#a1a1aa',
  padding: '0 16px 10px',
}

const CLEAR_BTN_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '6px 10px',
  background: 'rgba(255, 255, 255, 0.1)',
  border: '1px solid rgba(255, 255, 255, 0.3)',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.15s ease',
  fontFamily: 'inherit',
}

function ChatPanel({
  isOpen,
  messages,
  isTyping,
  onSend,
  onAddToCart,
  onQuickReply,
  onClear,
  placeholder,
  headerTitle = 'Shopping Assistant',
  headerStatus = 'Online',
  resetLabel = 'Resetează conversația',
  resetConfirm = 'Resetezi conversația? Istoricul se va șterge.',
  poweredBy = 'Powered by ACG',
  accentColor = '#f71963',
}: ChatPanelProps) {
  const headerStyle: React.CSSProperties = {
    background: accentColor,
    color: '#fff',
    padding: '16px 20px',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  }

  // Only show the clear button when there's more than the greeting
  const hasUserMessages = messages.some((m) => m.role === 'user')

  const handleClearClick = () => {
    if (window.confirm(resetConfirm)) {
      onClear()
    }
  }

  return (
    <div style={isOpen ? PANEL_OPEN : PANEL_BASE} role="dialog" aria-label="Chat">
      <div style={headerStyle}>
        <div>
          <div style={TITLE_STYLE}>{headerTitle}</div>
          <div style={STATUS_STYLE}>
            <span style={STATUS_DOT} />
            {headerStatus}
          </div>
        </div>
        {hasUserMessages && (
          <button
            onClick={handleClearClick}
            style={CLEAR_BTN_STYLE}
            aria-label={resetLabel}
            title={resetLabel}
            type="button"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            <span style={{ marginLeft: '6px' }}>Reset</span>
          </button>
        )}
      </div>

      <div style={BODY_STYLE}>
        <MessageList
          messages={messages}
          isTyping={isTyping}
          onAddToCart={onAddToCart}
          onQuickReply={onQuickReply}
        />
      </div>

      <div style={{ flexShrink: 0 }}>
        <ChatInput onSend={onSend} disabled={isTyping} placeholder={placeholder} />
        <div style={POWERED_STYLE}>{poweredBy}</div>
      </div>
    </div>
  )
}

export default ChatPanel
