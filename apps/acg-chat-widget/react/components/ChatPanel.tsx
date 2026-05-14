import React from 'react'

import type { Message } from '../types/domain'
import {
  ACCENT_PINK,
  OVERLAY_WHITE_10,
  OVERLAY_WHITE_20,
  WHITE,
} from '../utils/theme'
import MessageList from './MessageList'
import ChatInput from './ChatInput'
import {
  BODY_STYLE,
  CLEAR_BTN_STYLE,
  PANEL_BASE,
  PANEL_OPEN,
  POWERED_STYLE,
  STATUS_DOT,
  STATUS_STYLE,
  TITLE_STYLE,
} from './ChatPanel.styles'

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
  accentColor = ACCENT_PINK,
}: ChatPanelProps) {
  // Header style is computed inline because it depends on the profile's
  // accentColor prop — all other styles live in ChatPanel.styles.ts.
  const headerStyle: React.CSSProperties = {
    background: accentColor,
    color: WHITE,
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
              e.currentTarget.style.background = OVERLAY_WHITE_20
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = OVERLAY_WHITE_10
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
