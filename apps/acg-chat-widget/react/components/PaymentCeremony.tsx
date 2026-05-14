import React, { useEffect, useRef, useState } from 'react'

import type { Mandate } from '../types/domain'
import type { PaymentResult } from '../types/api'
import { executePayment } from '../services/payment-api'
import { formatCurrencyUnits } from '../utils/format-price'
import {
  AP2_REJECTED,
  AP2_SUCCESS,
  GRAY_SECONDARY_LINK,
} from '../utils/theme'
import {
  ARTIFACT_LINK,
  ARTIFACT_ROW,
  CARD_STYLE,
  CHECK_DOT,
  CHECKS_GRID,
  HEADER_ROW,
  META_ROW,
  PRIMARY_CTA,
  PRIMARY_CTA_DISABLED,
  RESULT_REJECTED,
  RESULT_SUCCESS,
  SECONDARY_LINK,
  SECONDARY_ROW,
  SECONDARY_SEP,
  STEP_ICON_FAIL,
  STEP_ICON_OK,
  STEP_LIST,
  STEP_ROW_FAILED,
  STEP_ROW_HIDDEN,
  STEP_ROW_VISIBLE,
} from './PaymentCeremony.styles'

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
            style={{ ...SECONDARY_LINK, color: GRAY_SECONDARY_LINK }}
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
                        color: ok ? AP2_SUCCESS.textBody : AP2_REJECTED.text,
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
          <div style={{ color: failed ? AP2_REJECTED.textEmph : AP2_SUCCESS.textMuted, fontSize: '11px' }}>
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
