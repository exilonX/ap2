import type React from 'react'

import {
  GRAY_MUTED,
  ONLINE_GREEN,
  OVERLAY_WHITE_10,
  OVERLAY_WHITE_30,
  SHADOW_PANEL,
  WHITE,
} from '../utils/theme'

export const PANEL_BASE: React.CSSProperties = {
  position: 'absolute',
  bottom: '72px',
  right: '0',
  width: '880px',
  maxWidth: 'calc(100vw - 40px)',
  height: '800px',
  maxHeight: 'calc(100vh - 120px)',
  background: WHITE,
  borderRadius: '16px',
  boxShadow: SHADOW_PANEL,
  display: 'flex',
  flexDirection: 'column' as const,
  overflow: 'hidden',
  opacity: 0,
  transform: 'translateY(16px) scale(0.95)',
  pointerEvents: 'none' as const,
  transition: 'opacity 0.25s ease, transform 0.25s ease',
}

export const PANEL_OPEN: React.CSSProperties = {
  ...PANEL_BASE,
  opacity: 1,
  transform: 'translateY(0) scale(1)',
  pointerEvents: 'auto' as const,
}

export const TITLE_STYLE: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 600,
  lineHeight: '1.3',
}

export const STATUS_STYLE: React.CSSProperties = {
  fontSize: '12px',
  opacity: 0.9,
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  marginTop: '2px',
}

export const STATUS_DOT: React.CSSProperties = {
  width: '8px',
  height: '8px',
  background: ONLINE_GREEN,
  borderRadius: '50%',
  display: 'inline-block',
}

export const BODY_STYLE: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
}

export const POWERED_STYLE: React.CSSProperties = {
  textAlign: 'center',
  fontSize: '10px',
  color: GRAY_MUTED,
  padding: '0 16px 10px',
}

export const CLEAR_BTN_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  padding: '6px 10px',
  background: OVERLAY_WHITE_10,
  border: `1px solid ${OVERLAY_WHITE_30}`,
  borderRadius: '8px',
  color: WHITE,
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.15s ease',
  fontFamily: 'inherit',
}
