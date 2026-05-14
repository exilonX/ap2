/**
 * All static styles for PaymentCeremony.
 *
 * Two cohesive palettes drive everything below:
 *   - AP2_SUCCESS — the green family for the signed-and-approved beat
 *   - AP2_REJECTED — the red family for the always-emit rejection beat
 *
 * Tokens live in `utils/theme.ts`. Keep this file purely declarative —
 * no logic, no React, just typed style objects.
 */

import type React from 'react'

import {
  AP2_REJECTED,
  AP2_SUCCESS,
  FONT_STACK_MONO,
  STEP_ROW_SURFACE,
  WHITE,
} from '../utils/theme'

export const CARD_STYLE: React.CSSProperties = {
  marginTop: '4px',
  padding: '12px 14px',
  background: `linear-gradient(180deg, ${AP2_SUCCESS.surfaceFrom} 0%, ${AP2_SUCCESS.surfaceTo} 100%)`,
  border: `1px solid ${AP2_SUCCESS.border}`,
  borderRadius: '12px',
  fontSize: '13px',
  lineHeight: '1.5',
  color: AP2_SUCCESS.text,
}

export const HEADER_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontWeight: 600,
  marginBottom: '6px',
}

export const CHECK_DOT: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  background: AP2_SUCCESS.primary,
  color: WHITE,
  fontSize: '13px',
  fontWeight: 700,
  flexShrink: 0,
}

export const META_ROW: React.CSSProperties = {
  fontSize: '11px',
  color: AP2_SUCCESS.textMuted,
  fontFamily: FONT_STACK_MONO,
  wordBreak: 'break-all',
  marginBottom: '10px',
}

export const PRIMARY_CTA: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  width: '100%',
  padding: '10px 14px',
  background: `linear-gradient(135deg, ${AP2_SUCCESS.primary} 0%, ${AP2_SUCCESS.primaryDark} 100%)`,
  color: WHITE,
  fontWeight: 600,
  fontSize: '13px',
  borderRadius: '10px',
  border: 'none',
  cursor: 'pointer',
  marginBottom: '8px',
  fontFamily: 'inherit',
}

export const PRIMARY_CTA_DISABLED: React.CSSProperties = {
  ...PRIMARY_CTA,
  opacity: 0.7,
  cursor: 'not-allowed',
}

export const SECONDARY_ROW: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  marginTop: '4px',
}

export const SECONDARY_LINK: React.CSSProperties = {
  color: AP2_SUCCESS.primary,
  textDecoration: 'underline',
}

export const SECONDARY_SEP: React.CSSProperties = {
  color: AP2_SUCCESS.borderSoft,
}

export const STEP_LIST: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  marginTop: '10px',
}

const STEP_ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  padding: '8px 10px',
  background: STEP_ROW_SURFACE,
  border: `1px solid ${AP2_SUCCESS.border}`,
  borderRadius: '8px',
  fontSize: '12px',
}

export const STEP_ROW_HIDDEN: React.CSSProperties = {
  ...STEP_ROW,
  opacity: 0,
  transform: 'translateY(-4px)',
}

export const STEP_ROW_VISIBLE: React.CSSProperties = {
  ...STEP_ROW,
  opacity: 1,
  transform: 'translateY(0)',
  transition: 'opacity 180ms ease, transform 180ms ease',
}

export const STEP_ROW_FAILED: React.CSSProperties = {
  ...STEP_ROW_VISIBLE,
  borderColor: AP2_REJECTED.border,
  background: AP2_REJECTED.rowSurface,
  color: AP2_REJECTED.text,
}

const STEP_ICON: React.CSSProperties = {
  width: '16px',
  height: '16px',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: WHITE,
  fontSize: '10px',
  fontWeight: 700,
  flexShrink: 0,
  marginTop: '2px',
}

export const STEP_ICON_OK: React.CSSProperties = {
  ...STEP_ICON,
  background: AP2_SUCCESS.primary,
}

export const STEP_ICON_FAIL: React.CSSProperties = {
  ...STEP_ICON,
  background: AP2_REJECTED.border,
}

export const CHECKS_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '4px 12px',
  marginTop: '6px',
  fontSize: '11px',
}

const RESULT_PANEL_BASE: React.CSSProperties = {
  marginTop: '10px',
  padding: '12px 14px',
  borderRadius: '10px',
  fontSize: '12px',
  lineHeight: '1.5',
}

export const RESULT_SUCCESS: React.CSSProperties = {
  ...RESULT_PANEL_BASE,
  background: `linear-gradient(180deg, ${AP2_SUCCESS.panelFrom} 0%, ${AP2_SUCCESS.panelTo} 100%)`,
  border: `2px solid ${AP2_SUCCESS.borderEmph}`,
  color: AP2_SUCCESS.textBody,
}

export const RESULT_REJECTED: React.CSSProperties = {
  ...RESULT_PANEL_BASE,
  background: `linear-gradient(180deg, ${AP2_REJECTED.surfaceFrom} 0%, ${AP2_REJECTED.surfaceTo} 100%)`,
  border: `2px solid ${AP2_REJECTED.border}`,
  color: AP2_REJECTED.text,
}

export const ARTIFACT_ROW: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  marginTop: '8px',
}

export const ARTIFACT_LINK: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  background: WHITE,
  border: `1px solid ${AP2_SUCCESS.border}`,
  borderRadius: '6px',
  color: AP2_SUCCESS.primary,
  fontSize: '11px',
  textDecoration: 'none',
  fontWeight: 500,
}
