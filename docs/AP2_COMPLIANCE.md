# AP2 Protocol Compliance — ACG Implementation

**Reference (text):** [AP2 v0.1.0 Specification](ap2-specification-v0.1.md) (file pinned to v0.1; canonical Pydantic now at v0.2)
**Reference (canonical Pydantic / v0.2):** https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/models/

This document is the running ledger of AP2 spec-compliance and known deviations. Updated as the implementation evolves.

---

## Status as of 2026-05-07

| Artifact | Status | Wire format |
|---|---|---|
| **CartMandate** | Shipped (pre-W3C shape) | `{ contents: CartContents, merchant_authorization: JWT }` — flat `payment_items[]` + `total`, NOT yet wrapped in W3C PaymentRequest |
| **PaymentMandate** | Shipped (v0.2-canonical wire format) | `{ payment_mandate_contents, user_authorization: JWT }` — fields match Google's Pydantic line-for-line, plus a project extension `x_agent_presence` carrying AP2 §4.1.3 signals |
| **PaymentReceipt** | Shipped (project shape — spec doesn't formalize yet) | `{ contents, network_authorization: JWT }`, mirrors CartMandate's structure for consistency. Always emitted (approve OR reject — signed evidence either way) |
| **IntentMandate** | Not implemented | — |

## Three-party trust chain (Step 6 / ADR-0003)

```
Merchant Endpoint              Credentials Provider               Payment Network
(Adapter)                      (mock @acg/mock-payment-network)   (mock @acg/mock-payment-network)
  signs CartMandate              signs PaymentMandate                verifies + emits PaymentReceipt
  did:web:<host>                 did:web:<host>:mock-cp              did:web:<host>:mock-network
  /_v/acg/.well-known/did.json   /_v/acg/mock-cp/.well-known/...     /_v/acg/mock-network/.well-known/...
```

Each party owns its own Ed25519 keypair via the `KeyStore` abstraction from `@acg/core` (per ADR-0001), persisted in a separate VBase bucket (per ADR-0003). Each artifact is independently retrievable + verifiable via its own REST route.

---

## Field-level compliance

### CartMandate

| Spec field | Our impl | Status |
|---|---|---|
| `contents.id` | `mandate-{16 hex}` | Compliant |
| `contents.merchant_name` | `did:web:{domain}` | Compliant |
| `contents.payment_request` (W3C) | Pre-W3C: flat `payment_items[]` + `total` | **Deviation — v1.x post-demo work** (see below) |
| `contents.cart_expiry` (ISO 8601) | Yes | Compliant |
| `contents.user_cart_confirmation_required` | Not present in our shape | Deviation (chat conversation handles confirmation) |
| `merchant_authorization` (JWT, base64url) | EdDSA Ed25519 JWT | Compliant |
| `merchant_authorization.iss` | `did:web:{domain}` | Compliant |
| `merchant_authorization.sub` | mandate id | Compliant |
| `merchant_authorization.aud` | `"ap2"` | Compliant |
| `merchant_authorization.iat / exp` | Unix timestamps | Compliant |
| `merchant_authorization.jti` | random hex nonce | Compliant |
| `merchant_authorization.cart_hash` | SHA-256 of JCS-canonicalized `CartContents` | Compliant |

### PaymentMandate (v0.2-canonical, with `x_agent_presence` extension)

| Spec field | Our impl | Status |
|---|---|---|
| `payment_mandate_contents.payment_mandate_id` | `pm-{16 hex}` | Compliant |
| `payment_mandate_contents.payment_details_id` | = `CartMandate.contents.id` | Compliant |
| `payment_mandate_contents.payment_details_total` | W3C `PaymentItem` (label + amount + refund_period) | Compliant |
| `payment_mandate_contents.payment_response` | W3C `PaymentResponse` (request_id, method_name, details.token) | Compliant |
| `payment_mandate_contents.merchant_agent` | merchant DID | Compliant |
| `payment_mandate_contents.timestamp` | ISO 8601 | Compliant |
| `payment_mandate_contents.x_agent_presence` (project extension) | `{ agent_involved, human_present }` per AP2 §4.1.3 | Compliant signal; see below |
| `user_authorization` | EdDSA Ed25519 JWT signed by mock CP, with `transaction_data: [hash(CartMandate), hash(PaymentMandateContents)]` claim | **Deviation — sd-jwt-vc post-demo** (see below) |

### PaymentReceipt (project shape; spec doesn't formalize yet)

| Field | Type | Notes |
|---|---|---|
| `contents.receipt_id` | string | `rcpt-{16 hex}` |
| `contents.payment_mandate_id` | string | links to PaymentMandate |
| `contents.cart_mandate_id` | string | = `payment_details_id` |
| `contents.network_did`, `merchant_did`, `cp_did` | strings | the three party DIDs at receipt time |
| `contents.amount` | W3C `PaymentCurrencyAmount` | settlement amount |
| `contents.agent_presence` | `AgentPresence` | propagated from PaymentMandate |
| `contents.verification_checks` | 7-bool object | merchant_signature, cp_signature, hash_binding, amount_consistency, mandate_id_linking, payment_mandate_not_expired, cart_mandate_not_expired |
| `contents.approval_status` | `'approved'` \| `'rejected'` | derived from verification_checks |
| `contents.rejection_reason` | string \| undefined | first failing check named, on rejection |
| `network_authorization` | EdDSA Ed25519 JWT | signed by Network's key over JCS(`contents`) |

---

## Known deviations (post-demo work)

### 1. CartMandate not yet v0.2 W3C-wrapped

**What:** v0.2 wraps cart contents in a W3C `PaymentRequest` (`method_data`, `details: PaymentDetailsInit`, `options`). Our implementation keeps a flat `payment_items[] + total` shape closer to v0.1.

**Why deferred:** Refactoring CartMandate's signing primitive touches 87+ tests and the JWT `cart_hash` over JCS — high risk during the demo cycle.

**Tracking:** ISSUES.md 0017 (post-demo).

### 2. `user_authorization` is plain Ed25519 JWS, not sd-jwt-vc

**What:** Spec says `user_authorization` is an sd-jwt-vc with KB-JWT and selective disclosure. We use an Ed25519 JWS carrying the same `transaction_data` claim.

**Why:** sd-jwt-vc adds non-trivial library + KB-JWT + disclosure-set engineering. The cryptographic content (signature over `transaction_data`) is equivalent.

**Tracking:** ISSUES.md 0018 (post-demo).

### 3. `agent_presence` is hardcoded `human_present: true`

**What:** All flows in v1 are interactive (chat widget or Claude Desktop), so `human_present` is hardcoded. Autonomous flows (IntentMandate-driven) would set it `false`.

**Why:** No autonomous flow exists yet — IntentMandate is unimplemented.

**Tracking:** ISSUES.md 0019 (post-demo, paired with IntentMandate work).

### 4. Mock CP signs PaymentMandate without user device-tap

**What:** Real AP2 CP would require a user-device-tap consent (TPM/secure-element-backed) before signing. Our mock CP signs unconditionally when called.

**Why:** Demo doesn't model device-side authentication; production CP integration (Google Pay / wallet) replaces this.

**Tracking:** Implicit in the production swap-in plan; documented in ADR-0003.

### 5. IntentMandate not implemented

**What:** Human-not-present authorization (delegated purchases — "buy when price drops") needs IntentMandate per AP2 §4.1.

**Why deferred:** Demo focuses on human-present flow.

**Tracking:** ISSUES.md 0019 (paired with `agent_presence` dynamic derivation).

### 6. No 3DS2 step-up simulation

**What:** Real payment networks use 3DS2 for step-up authentication on suspicious transactions.

**Why deferred:** Demo recording impact is marginal; engineering cost is real.

**Tracking:** ISSUES.md 0020 (post-demo).

---

## Architecture alignment with AP2 roles

| AP2 Role | Our Implementation |
|----------|-------------------|
| **User** | Human chatting with the widget or Claude Desktop |
| **Shopping Agent (SA)** | Claude / chat handler / MCP Server |
| **Merchant Endpoint (ME)** | VTEX IO Adapter (`packages/vtex-io-adapter`), holds `MerchantIdentity` per ADR-0001 |
| **Merchant Payment Processor (MPP)** | Real path: VTEX Checkout + Payment Gateway. Demo path: mock order id from `execute_payment` REST endpoint. |
| **Credentials Provider (CP)** | Mock — `MockCredentialsProvider` from `@acg/mock-payment-network`, with its own DID. Production: replace with Google Pay / wallet integration. |
| **Payment Network** | Mock — `MockPaymentNetwork` from same package, with its own DID. Production: replace with Visa / Mastercard / etc. |
| **Verifier** | Anyone with the published DID document URLs can verify any artifact (CartMandate, PaymentMandate, PaymentReceipt) independently |

## Cryptographic details

| Aspect | Our impl | AP2 spec |
|---|---|---|
| Signing algorithm | EdDSA (Ed25519) | Not mandated; samples vary |
| Key format | DER (SPKI/PKCS8) | Not specified |
| Identity | `did:web` (self-issued) | Not specified for v0.1; v0.2 expects DIDs |
| Cart / mandate / receipt hash | SHA-256 of JCS (RFC 8785) | "Secure hash of canonical JSON" |
| JWT library | `jose` v4 (Node.js) | N/A (Python samples use fake JWTs) |

---

## Path to full v1.x compliance

1. **CartMandate v0.2 W3C-wrap** — refactor `CartContents` to wrap a `PaymentRequest`. Ripple through `cart_hash` (still JCS-stable), tests, drift detection.
2. **`user_authorization` = sd-jwt-vc** — adopt sd-jwt-vc library, KB-JWT for binding, selective disclosure where useful.
3. **IntentMandate** — implement for human-not-present scenarios; pair with agent_presence dynamic derivation.
4. **A2A transport** — wrap mandates in A2A DataParts with the canonical keys (`ap2.mandates.CartMandate`, `ap2.mandates.PaymentMandate`).
5. **User-device signing** — replace mock CP with TPM/secure-element-backed device key (browser WebAuthn, mobile keystore).
6. **3DS2 simulation** — iframe-driven step-up flow.
7. **Real provider integrations** — Google Pay (CP), Visa Intelligent Commerce / Mastercard (Network) when their AP2 sandboxes ship.
