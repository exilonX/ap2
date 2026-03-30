# AP2 Protocol Compliance — ACG Implementation

**Reference:** [AP2 v0.1.0 Specification](ap2-specification-v0.1.md)
**Source:** https://github.com/google-agentic-commerce/AP2

---

## Implementation Status

### CartMandate — Implemented

| Spec Requirement | Our Implementation | Status |
|-----------------|-------------------|--------|
| Nested structure: `{ contents, merchant_authorization }` | Yes | Compliant |
| `contents.id` — unique cart ID | `mandate-{random}` | Compliant |
| `contents.merchant_name` | `did:web:{domain}` | Compliant |
| `contents.payment_request` — W3C PaymentRequest | Simplified: `payment_items` (PaymentItem[]) + `total` | Partial |
| `contents.cart_expiry` — ISO 8601 | Yes | Compliant |
| `merchant_authorization` — JWT (base64url) | EdDSA (Ed25519) JWT with standard claims | Compliant |
| JWT `iss` — merchant identifier | `did:web:{domain}` | Compliant |
| JWT `sub` — cart/mandate ID | Yes | Compliant |
| JWT `aud` — audience | `"ap2"` | Compliant |
| JWT `iat`, `exp` — timestamps | Unix timestamps | Compliant |
| JWT `jti` — unique ID (replay protection) | Random hex nonce | Compliant |
| JWT `cart_hash` — hash of CartContents | SHA-256 of JCS-canonicalized (RFC 8785) contents | Compliant |

### Key Differences from Spec

1. **PaymentRequest format:** The spec uses the full W3C PaymentRequest structure (`method_data`, `details`, `options`). We use a simplified `payment_items` array with `PaymentItem` objects. This is intentional — our adapter converts platform-specific cart data (VTEX orderForm) into the W3C-compatible format. Full PaymentRequest support is planned for when payment method selection is implemented.

2. **`user_cart_confirmation_required` field:** Not implemented. In our flow, user confirmation happens via the Claude Desktop conversation (explicit "yes" before checkout).

3. **`merchant_signature` vs `merchant_authorization`:** We use `merchant_authorization` (JWT) per the latest spec. The spec sample code shows `merchant_signature` in some examples — this appears to be an older naming.

### IntentMandate — Not Implemented (V1.x)

The IntentMandate is for human-not-present scenarios. Our current implementation focuses on the human-present flow where the user is actively chatting with Claude. IntentMandate will be needed for delegated purchases ("buy this when the price drops below X").

### PaymentMandate — Not Implemented (V1.x)

The PaymentMandate provides payment network visibility into agentic transactions. This requires integration with a Credentials Provider (digital wallet) and is beyond the scope of our current VTEX integration. The PaymentMandate is what gives Visa/Mastercard/Issuers the "AI agent was involved" signal.

### PaymentReceipt — Not Implemented

Will be added when end-to-end payment processing is integrated.

---

## Architecture Alignment

| AP2 Role | Our Implementation |
|----------|-------------------|
| **User** | Human chatting with Claude Desktop |
| **Shopping Agent (SA)** | Claude + MCP Server (`packages/mcp-server`) |
| **Merchant Endpoint (ME)** | VTEX IO Adapter (`packages/vtex-io-adapter`) |
| **Merchant Payment Processor (MPP)** | VTEX Checkout + Payment Gateway |
| **Credentials Provider (CP)** | Not implemented (user enters payment in VTEX native checkout) |
| **Network/Issuer** | Standard VTEX payment processing |

## Cryptographic Details

| Aspect | Our Implementation | AP2 Spec |
|--------|-------------------|----------|
| **Signing algorithm** | EdDSA (Ed25519) | Not mandated; samples show RS256 |
| **Key format** | DER (SPKI/PKCS8) | Not specified |
| **Identity** | did:web (self-issued) | Not specified for V0.1 |
| **Cart hash** | SHA-256 of JCS (RFC 8785) canonical JSON | "Secure hash of canonical JSON" |
| **JWT library** | `jose` v4 (Node.js) | N/A (Python samples use fake JWTs) |

## What's Next for Full Compliance

1. **Full W3C PaymentRequest** — Expand `CartContents` to include `method_data`, `details.displayItems`, `options` per W3C spec
2. **IntentMandate** — For human-not-present delegated purchases
3. **PaymentMandate + Credentials Provider** — For payment network visibility
4. **A2A transport** — Carry mandates in A2A DataParts with canonical keys (`ap2.mandates.CartMandate`)
5. **User-side signing** — SD-JWT-VC with hardware-backed device keys (requires mobile/browser integration)
