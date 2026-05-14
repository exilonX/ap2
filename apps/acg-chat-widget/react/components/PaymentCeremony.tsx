import React, { useEffect, useRef, useState } from 'react'

import type { Mandate } from '../types/domain'
import type { PaymentResult } from '../types/api'
import { executePayment } from '../services/payment-api'
import { formatCurrencyUnits } from '../utils/format-price'

interface PaymentCeremonyProps {
  mandate: Mandate
}

// ─── State machine ───────────────────────────────────────────────
// idle      — show "Pay Now" button + secondary VTEX link
// pending   — POST /payment/execute in flight; show "Verifying mandate..."
// revealing — response received; animated step reveals running
// success   — final panel with three artifact links
// rejected  — rejection panel with PaymentReceipt link (always-emit invariant)
// error     — network/transport failure (rare)
type CeremonyState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'revealing'; result: PaymentResult; revealedSteps: number; revealedChecks: number }
  | { kind: 'success'; result: PaymentResult }
  | { kind: 'rejected'; result: PaymentResult }
  | { kind: 'error'; message: string }

// ─── Visual constants ────────────────────────────────────────────
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

const PRIMARY_CTA: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  width: '100%',
  padding: '10px 14px',
  background: 'linear-gradient(135deg, #2e7d32 0%, #1b5e20 100%)',
  color: '#fff',
  fontWeight: 600,
  fontSize: '13px',
  borderRadius: '10px',
  border: 'none',
  cursor: 'pointer',
  marginBottom: '8px',
  fontFamily: 'inherit',
}

const PRIMARY_CTA_DISABLED: React.CSSProperties = {
  ...PRIMARY_CTA,
  opacity: 0.7,
  cursor: 'not-allowed',
}

const SECONDARY_ROW: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  marginTop: '4px',
}

const SECONDARY_LINK: React.CSSProperties = {
  color: '#2e7d32',
  textDecoration: 'underline',
}

const SECONDARY_SEP: React.CSSProperties = {
  color: '#9ccc9c',
}

const STEP_LIST: React.CSSProperties = {
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
  background: 'rgba(255,255,255,0.55)',
  border: '1px solid #c8e6c9',
  borderRadius: '8px',
  fontSize: '12px',
}

const STEP_ROW_HIDDEN: React.CSSProperties = {
  ...STEP_ROW,
  opacity: 0,
  transform: 'translateY(-4px)',
}

const STEP_ROW_VISIBLE: React.CSSProperties = {
  ...STEP_ROW,
  opacity: 1,
  transform: 'translateY(0)',
  transition: 'opacity 180ms ease, transform 180ms ease',
}

const STEP_ROW_FAILED: React.CSSProperties = {
  ...STEP_ROW_VISIBLE,
  borderColor: '#cf222e',
  background: 'rgba(255, 245, 245, 0.7)',
  color: '#6e1117',
}

const STEP_ICON: React.CSSProperties = {
  width: '16px',
  height: '16px',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  fontSize: '10px',
  fontWeight: 700,
  flexShrink: 0,
  marginTop: '2px',
}

const STEP_ICON_OK: React.CSSProperties = { ...STEP_ICON, background: '#2e7d32' }
const STEP_ICON_FAIL: React.CSSProperties = { ...STEP_ICON, background: '#cf222e' }

const CHECKS_GRID: React.CSSProperties = {
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

const RESULT_SUCCESS: React.CSSProperties = {
  ...RESULT_PANEL_BASE,
  background: 'linear-gradient(180deg, #f0f9f1 0%, #e8f5ea 100%)',
  border: '2px solid #2ea043',
  color: '#1a5028',
}

const RESULT_REJECTED: React.CSSProperties = {
  ...RESULT_PANEL_BASE,
  background: 'linear-gradient(180deg, #fdf3f3 0%, #fbe9e9 100%)',
  border: '2px solid #cf222e',
  color: '#6e1117',
}

const ARTIFACT_ROW: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
  marginTop: '8px',
}

const ARTIFACT_LINK: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  background: '#fff',
  border: '1px solid #c8e6c9',
  borderRadius: '6px',
  color: '#2e7d32',
  fontSize: '11px',
  textDecoration: 'none',
  fontWeight: 500,
}

// ─── Format helpers ───────────────────────────────────────────────
function shortDid(did: string): string {
  return did.replace(/^did:web:/, '')
}

// ─── 7-check labels (matches the iframe) ─────────────────────────
const CHECK_ORDER: Array<{ key: string; label: string }> = [
  { key: 'merchant_signature', label: 'Merchant signature' },
  { key: 'cp_signature', label: 'CP signature' },
  { key: 'hash_binding', label: 'transaction_data hash binding' },
  { key: 'amount_consistency', label: 'Amount matches cart total' },
  { key: 'mandate_id_linking', label: 'PaymentMandate references CartMandate' },
  { key: 'payment_mandate_not_expired', label: 'PaymentMandate not expired' },
  { key: 'cart_mandate_not_expired', label: 'CartMandate not expired' },
]

// ─── The component ────────────────────────────────────────────────
function PaymentCeremony({ mandate }: PaymentCeremonyProps) {
  const [state, setState] = useState<CeremonyState>({ kind: 'idle' })
  // Refs to track timers so we can cancel on unmount
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    return () => {
      // Clean up any pending setTimeout calls if the component unmounts
      timersRef.current.forEach((id) => window.clearTimeout(id))
      timersRef.current = []
    }
  }, [])

  function scheduleReveal(result: PaymentResult): void {
    // Sequenced reveal of the 4 ceremony steps. Timing mirrors the
    // Claude Desktop iframe (250 / 700 / 1100 / 1700 ms) but tuned for
    // a chat-embedded surface — keeps the same visual centerpiece (the
    // 7-check checklist animating in at step 3).
    setState({ kind: 'revealing', result, revealedSteps: 0, revealedChecks: 0 })

    const schedule = [
      { delay: 250, steps: 1, checks: 0 },
      { delay: 700, steps: 2, checks: 0 },
      { delay: 1100, steps: 3, checks: 0 },
      // 7 checks staggered between 1100 and 1700, then step 4 lands
      { delay: 1200, steps: 3, checks: 1 },
      { delay: 1280, steps: 3, checks: 2 },
      { delay: 1360, steps: 3, checks: 3 },
      { delay: 1440, steps: 3, checks: 4 },
      { delay: 1520, steps: 3, checks: 5 },
      { delay: 1600, steps: 3, checks: 6 },
      { delay: 1680, steps: 3, checks: 7 },
      { delay: 1750, steps: 4, checks: 7 },
    ]

    schedule.forEach(({ delay, steps, checks }) => {
      const id = window.setTimeout(() => {
        setState((prev) =>
          prev.kind === 'revealing'
            ? { ...prev, revealedSteps: steps, revealedChecks: checks }
            : prev
        )
      }, delay)
      timersRef.current.push(id)
    })

    // Final state transition once all reveals complete
    const finalId = window.setTimeout(() => {
      setState(
        result.success
          ? { kind: 'success', result }
          : { kind: 'rejected', result }
      )
    }, 2000)
    timersRef.current.push(finalId)
  }

  async function handlePayNow(): Promise<void> {
    if (state.kind !== 'idle') return
    setState({ kind: 'pending' })
    try {
      const result = await executePayment(mandate.mandateId)
      scheduleReveal(result)
    } catch (err) {
      setState({
        kind: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'Payment request failed — try again',
      })
    }
  }

  // ─── Idle / Pending render ─────────────────────────────────────
  if (state.kind === 'idle' || state.kind === 'pending' || state.kind === 'error') {
    return (
      <div
        style={CARD_STYLE}
        role="note"
        aria-label="Cryptographically signed cart mandate"
      >
        <div style={HEADER_ROW}>
          <span style={CHECK_DOT} aria-hidden="true">
            ✓
          </span>
          <span>Cryptographically signed by {shortDid(mandate.signedBy)}</span>
        </div>
        <div style={META_ROW}>{mandate.mandateId}</div>

        <button
          type="button"
          style={state.kind === 'pending' ? PRIMARY_CTA_DISABLED : PRIMARY_CTA}
          onClick={handlePayNow}
          disabled={state.kind === 'pending'}
        >
          {state.kind === 'pending'
            ? 'Verifying mandate against cart…'
            : `Finalizează plata — ${formatCurrencyUnits(mandate.total, mandate.currency)} →`}
        </button>

        {state.kind === 'error' ? (
          <div
            style={{
              ...RESULT_REJECTED,
              marginTop: '8px',
              fontSize: '11px',
            }}
          >
            {state.message}
          </div>
        ) : null}

        <div style={SECONDARY_ROW}>
          <a
            href={mandate.retrievalUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={SECONDARY_LINK}
          >
            View mandate proof →
          </a>
          <span style={SECONDARY_SEP}>·</span>
          <a
            href={mandate.didDocumentUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={SECONDARY_LINK}
          >
            Verify merchant identity →
          </a>
          <span style={SECONDARY_SEP}>·</span>
          <a
            href={mandate.checkoutUrl}
            style={{ ...SECONDARY_LINK, color: '#666' }}
          >
            Or use VTEX standard checkout →
          </a>
        </div>
      </div>
    )
  }

  // ─── Revealing / Success / Rejected render ─────────────────────
  const result = state.kind === 'revealing' ? state.result : state.result
  const checks =
    result.paymentReceipt?.contents?.verification_checks ?? null
  const revealedSteps = state.kind === 'revealing' ? state.revealedSteps : 4
  const revealedChecks = state.kind === 'revealing' ? state.revealedChecks : 7

  const driftRejection = !result.success && !!result.drifted
  const allChecksOk =
    checks &&
    Object.values(checks).every((v) => v === true)

  return (
    <div style={CARD_STYLE}>
      <div style={HEADER_ROW}>
        <span style={CHECK_DOT} aria-hidden="true">
          ✓
        </span>
        <span>Cryptographically signed by {shortDid(mandate.signedBy)}</span>
      </div>
      <div style={META_ROW}>{mandate.mandateId}</div>

      <div style={STEP_LIST}>
        <Step
          number={1}
          title="Verifying CartMandate against current cart"
          detail="Re-checking the signed mandate hasn't drifted from the live cart."
          revealed={revealedSteps >= 1}
          failed={driftRejection}
        />
        <Step
          number={2}
          title="Credentials Provider signs PaymentMandate"
          detail="Binding cart hash + payment hash via transaction_data."
          revealed={revealedSteps >= 2}
          failed={driftRejection || (revealedSteps >= 2 && checks ? !checks.cp_signature : false)}
        />
        <Step
          number={3}
          title="Payment Network verifies the chain"
          detail="Independent verification of merchant + CP signatures and binding."
          revealed={revealedSteps >= 3}
          failed={driftRejection || (revealedSteps >= 3 && checks ? !allChecksOk : false)}
          extra={
            revealedSteps >= 3 && checks ? (
              <div style={CHECKS_GRID}>
                {CHECK_ORDER.slice(0, revealedChecks).map((c) => {
                  const ok = !!checks[c.key as keyof typeof checks]
                  return (
                    <div
                      key={c.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: ok ? '#1a5028' : '#6e1117',
                      }}
                    >
                      <span aria-hidden="true">{ok ? '✓' : '✗'}</span>
                      <span>{c.label}</span>
                    </div>
                  )
                })}
              </div>
            ) : null
          }
        />
        <Step
          number={4}
          title={
            state.kind === 'success' || (state.kind === 'revealing' && result.success)
              ? `Order ${result.orderId ?? ''} placed`
              : 'Order not placed'
          }
          detail={
            state.kind === 'rejected' || (!result.success && revealedSteps >= 4)
              ? `Network rejected — ${result.reason ?? 'see receipt'}`
              : ''
          }
          revealed={revealedSteps >= 4}
          failed={!result.success}
        />
      </div>

      {state.kind === 'success' ? (
        <div style={RESULT_SUCCESS}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            ✓ Payment authorized · Order {result.orderId}
          </div>
          <div>
            Three parties cryptographically attested: the merchant signed the
            cart, the Credentials Provider signed the payment, and the network
            independently verified both before approving.
          </div>
          <ArtifactRow result={result} mandate={mandate} />
        </div>
      ) : null}

      {state.kind === 'rejected' ? (
        <div style={RESULT_REJECTED}>
          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
            ✗ Payment rejected
          </div>
          <div>
            <strong>Reason:</strong> {result.reason ?? 'unknown'}
          </div>
          {result.paymentReceipt ? (
            <div style={{ marginTop: '6px' }}>
              The network signed this rejection. The PaymentReceipt below is
              cryptographically valid evidence — anyone can verify it against
              the network's published DID. <strong>Always-emit invariant.</strong>
            </div>
          ) : null}
          <ArtifactRow result={result} mandate={mandate} />
        </div>
      ) : null}
    </div>
  )
}

// ─── Step row ─────────────────────────────────────────────────────
function Step({
  number,
  title,
  detail,
  revealed,
  failed,
  extra,
}: {
  number: number
  title: string
  detail: string
  revealed: boolean
  failed: boolean
  extra?: React.ReactNode
}) {
  if (!revealed) {
    return <div style={STEP_ROW_HIDDEN} aria-hidden="true" />
  }
  return (
    <div style={failed ? STEP_ROW_FAILED : STEP_ROW_VISIBLE}>
      <span style={failed ? STEP_ICON_FAIL : STEP_ICON_OK} aria-hidden="true">
        {failed ? '✗' : '✓'}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, marginBottom: '2px' }}>
          {number}. {title}
        </div>
        {detail ? (
          <div style={{ color: failed ? '#8a1d23' : '#33691e', fontSize: '11px' }}>
            {detail}
          </div>
        ) : null}
        {extra}
      </div>
    </div>
  )
}

// ─── Artifact link row ────────────────────────────────────────────
function ArtifactRow({
  result,
  mandate,
}: {
  result: PaymentResult
  mandate: Mandate
}) {
  const links: { label: string; url: string }[] = []
  if (mandate.retrievalUrl) {
    links.push({ label: 'CartMandate →', url: mandate.retrievalUrl })
  }
  if (result.paymentMandateUrl) {
    links.push({ label: 'PaymentMandate →', url: result.paymentMandateUrl })
  }
  if (result.paymentReceiptUrl) {
    links.push({ label: 'PaymentReceipt →', url: result.paymentReceiptUrl })
  }
  if (links.length === 0) return null
  return (
    <div style={ARTIFACT_ROW}>
      {links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          style={ARTIFACT_LINK}
        >
          {l.label}
        </a>
      ))}
    </div>
  )
}

export default PaymentCeremony
