import React from 'react'

import type { Mandate } from './types'
import PaymentCeremony from './PaymentCeremony'

interface MandateBadgeProps {
  mandate: Mandate
}

/**
 * MandateBadge renders the post-mandate-signing state in the chat.
 *
 * Delegates the entire interactive surface to PaymentCeremony, which
 * starts in `idle` (showing the signed mandate metadata + a primary
 * "Finalizează plata" CTA + secondary verification links) and
 * transitions through the AP2 payment ceremony when clicked:
 *
 *   idle → pending → revealing (4 steps + 7 checks) → success / rejected
 *
 * Mirrors the Claude Desktop iframe's in-chat payment beat — same
 * cryptographic backend, same artifact links, just rendered as React
 * components inside the chat conversation instead of an iframe.
 */
function MandateBadge({ mandate }: MandateBadgeProps) {
  return <PaymentCeremony mandate={mandate} />
}

export default MandateBadge
