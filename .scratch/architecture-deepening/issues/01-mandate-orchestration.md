## 0001 — Mandate Orchestration module (merchant-side AP2 ceremony)

- **Status:** ready-for-agent
- **Created:** 2026-05-05
- **Last updated:** 2026-05-05 (grilling complete)
- **GitHub:** _(filled when promoted)_
- **Priority:** P0 (this is the product we sell)
- **Demo-blocking:** Yes

### Context

The merchant-side AP2 mandate ceremony is the **primary product** for this project — what we extend, what we sell. `@acg/core` is already a deep, well-tested module (68 tests covering JCS, DID, Ed25519 signing, JWT mandate creation/verification, keystore). Its merchant-side counterpart in the Adapter is **shallow** and — discovered during grilling — also **broken at the trust root**:

1. **Two independent merchant identities exist for the same merchant.** `node/handlers/did.ts:27-78` generates a keypair via raw `crypto.generateKeyPairSync`, stores it in VBase `acg-identity`, serves the public half as `did:web:{domain}`. Separately, `packages/mcp-server/src/tools/checkout.ts:64-86` generates a *different* keypair via `@acg/core/loadOrCreateIdentity` into `~/.acg/keys/merchant.json` on the MCP host, and uses **that** key to sign CartMandates. The two keys never agree, so a mandate signed today **cannot be verified** against the public key in the DID document. The demo's verification step would silently fail if anyone ran it.

2. **The Shopping Agent currently holds merchant private keys**, violating the AP2 trust model directly. The MCP server is a Shopping Agent (per `CONTEXT.md` §3); it must never sign as the merchant. The merchant signs; the agent presents. The current code has the agent doing both.

3. **Two unverified write endpoints accept arbitrary "mandate" JSON.** Both `initiateCheckout` (when called with `{ mandate }` in the body) and `POST /_v/acg/mandates` (`storeMandate`) persist whatever the caller sends without verification. A Shopping Agent could send fake bytes and the Adapter would store them as merchant-signed.

4. **The chat Surface doesn't sign mandates at all.** The chat tool `checkout` returns a checkout URL but never calls `createCartMandate`. So the demo's P0 Surface (the chat widget) currently produces *unsigned* checkouts — there's nothing to verify in the demo recording.

The original framing ("extract a function") understates the work. This issue claims the merchant-side seam.

### Acceptance

The work splits into two new modules in the Adapter, plus a small refactor in `@acg/core`. All tests land in the same change as the code (per `feedback_test_as_we_go`).

#### A. `@acg/core/keystore.ts` — extract a pluggable storage abstraction

`@acg/core` stays platform-agnostic (no `@vtex/api` import, no VBase reference). Storage becomes pluggable via a tiny interface:

- A `KeyStore` interface with `read() → StoredKeys | null` and `write(stored) → void`.
- `loadOrCreateIdentity(domain, store: KeyStore) → MerchantIdentity` — refactored from filesystem-only to KeyStore-driven. Same `MerchantIdentity` return type as today.
- `FilesystemKeyStore(path)` — wraps existing fs logic; implements `KeyStore`.
- `EnvKeyStore()` — reads `MERCHANT_PUBLIC_KEY` / `MERCHANT_PRIVATE_KEY` / `MERCHANT_DOMAIN` env vars; implements `KeyStore` (read-only, write throws).
- A backwards-compat wrapper: `loadOrCreateIdentity(domain, path: string)` continues to work by delegating to `loadOrCreateIdentity(domain, new FilesystemKeyStore(path))`. Removed once the MCP server stops calling it.

Tests: `KeyStore` contract round-trip for both implementations, identity creation when store is empty, identity load when store has existing keys, error cases.

#### B. Adapter `node/identity/` — `VBaseKeyStore` + narrow `MerchantIdentity` module

The Adapter's contribution to the keystore abstraction. Lives in the Adapter; `@acg/core` doesn't know it exists.

- `VBaseKeyStore(vbaseClient, bucket, key)` — implements `KeyStore` against VBase. Storage location: `acg-identity/merchant-did` (the existing bucket/key from `did.ts`, so existing keys are picked up unchanged — no migration needed).
- `MerchantIdentity` module — the **narrow signing surface** for the merchant. Loads the identity once via `@acg/core/loadOrCreateIdentity(domain, vbaseStore)` and caches it. Exposes:
  - `getDID() → string`
  - `getDIDDocument() → DIDDocument`
  - `signCartMandate(cart) → Promise<CartMandate>` — internally calls `@acg/core/createCartMandate(cart, domain, identity.keys)`. The private key is loaded into the module's closure but **never returned to callers**.
  - (Future, not in this issue) `signPaymentMandate`, `signIntentMandate`.

`node/handlers/did.ts` shrinks to `ctx.body = await identity.getDIDDocument()` — the raw key generation and DID composition leave the handler.

Tests: VBase round-trip via a fake `vbase` client (mirrors the existing `acg-identity/merchant-did` shape); MerchantIdentity sign-then-verify round-trip using the public half it serves; rejection when the store returns malformed keys; idempotency (multiple `getDID` calls don't regenerate).

#### C. `MandateOrchestration` module — the merchant-side ceremony

Lives in the Adapter. Single owner of the CartMandate ceremony.

- `signAndPersist(cart, metadata) → EvidenceBundle` — calls `MerchantIdentity.signCartMandate`, builds the **Evidence Bundle** via `@acg/core/extractEvidenceBundle`, attaches caller-supplied platform metadata, persists to VBase (`acg-mandates/{mandateId}`), returns the bundle.
- `retrieve(mandateId) → EvidenceBundle | null` — fetches from VBase.
- `verify(mandateId) → MandateVerification` — re-runs `@acg/core/verifyCartMandate` against the current `MerchantIdentity` public key. Returns the structured verification result (signature valid, not expired, hash matches).

#### C.1 `@acg/core` — `EvidenceBundle` type and helper

Added to `@acg/core` (platform-agnostic; lives alongside `CartMandate`, `PaymentMandate`):

```ts
export interface EvidenceBundle {
  mandateId: string
  cartMandate: CartMandate
  cartHash: string                    // SHA-256 of JCS-canonicalized contents — matches JWT cart_hash claim
  paymentMandate?: PaymentMandate     // future
  signedAt: string                    // ISO timestamp
  signedBy: string                    // merchant DID at sign time (survives key rotation)
  metadata?: Record<string, unknown>  // opaque platform context
}

export function extractEvidenceBundle(
  mandate: CartMandate
): Omit<EvidenceBundle, 'metadata' | 'paymentMandate'>
```

`extractEvidenceBundle` decodes the JWT to pull `cartHash` (from the `cart_hash` claim) and `signedAt` (from `iat`), and reads `signedBy` from `mandate.contents.merchant_name`. The Adapter calls it and attaches its own `metadata: { sessionId, orderFormId }`.

Existing VBase entries at `acg-mandates/*` are signed by orphan MCP-host keys (per the trust-root finding) and are therefore invalid regardless of shape — Issue 01 effectively wipes the bucket. **No migration tooling required.**

#### C.2 Handler integration

The `initiateCheckout` handler shrinks to: load cart → `bundle = await mandates.signAndPersist(cart, { sessionId, orderFormId })` → return response with `mandateId` + `retrievalUrl`. The `mandate` parameter on the request body **is removed** — callers don't supply mandates anymore; the Adapter signs.

Tests:
- `extractEvidenceBundle` against fixture mandates (correct cartHash, signedAt, signedBy extraction; rejects malformed JWT).
- `signAndPersist` round-trip (sign → persist → retrieve returns identical bundle including metadata).
- `verify` returns `valid: true` for a freshly-signed bundle, `hashMatches: false` when `cartMandate.contents` is tampered, `notExpired: false` when the JWT is past expiry.
- Persistence shape stable: a bundle written today is readable by `retrieve` after a process restart (i.e. JSON-roundtrip-safe).

#### D. Removed surfaces (breaking changes, demo-justified)

- `mcp-server/src/tools/checkout.ts:64-86` — the in-MCP signing path is **deleted**. The MCP server's `checkoutInChat` and `checkout` tools just call `/_v/acg/checkout/initiate` without a mandate body; the Adapter signs and returns the mandate info in the response (which the MCP server then displays).
- `POST /_v/acg/mandates` (`storeMandate`) — **removed**. There's no longer any caller that needs to push a pre-signed mandate; the only writer is `MandateOrchestration.signAndPersist`. This closes the unverified-write hole. The route registration in `node/index.ts` and the `storeMandate` handler in `node/handlers/mandate.ts` are deleted.
- `~/.acg/keys/merchant.json` on MCP hosts — orphaned, no further action. The Adapter's existing VBase keys are the canonical merchant identity.

#### E. Demo wiring

The chat tool `checkout` (in `node/handlers/chat.ts`) calls `MandateOrchestration.signAndPersist(simpleCart, { sessionId, orderFormId })` — so the chat Surface produces signed mandates from this point. The tool's response includes the mandate ID, the retrieval URL, and the cart hash, so the demo recording can show "merchant just signed this; here's the proof URL; here's the DID document; signature verifies."

The cart input shape is `SimpleCart` (`packages/shared/types/cart.ts`) — the lingua franca already used across the Adapter. `MandateOrchestration` privately maps `SimpleCart → @acg/core/CartData` before calling `@acg/core/createCartMandate`. Issue 02's Cart module returns `SimpleCart`, so it slots in cleanly without coordination concerns.

#### F. `getMandate` handler — always returns verification

`GET /_v/acg/mandates/:id` returns the full `EvidenceBundle` plus a `verification` field carrying the *result* (not instructions, like today):

```ts
{
  bundle: EvidenceBundle,
  verification: {
    valid: boolean,
    checks: { signatureValid, notExpired, hashMatches },
    didDocumentUrl: string,   // for third parties who want to re-verify themselves
  }
}
```

Verification runs through `MandateOrchestration.verify(mandateId)` on every GET. Cost is ~1ms with the cached `MerchantIdentity` — not a hot path; it's a verification endpoint. The "instructions paragraph" the current handler returns is gone — the result tells the caller what they need to know; `didDocumentUrl` lets them re-verify if they want to.

Tests: GET on a fresh bundle returns `valid: true` with all checks passing; GET on a tampered bundle (manually mutate `cartMandate.contents` in VBase) returns `valid: false` with `hashMatches: false`; GET on an unknown id returns 404.

#### G. `verifyAgainstCart` — drift-detection primitive

`MandateOrchestration` exposes one composed operation that the demo's payment-acceptance step calls right before finalizing payment:

```ts
verifyAgainstCart(
  mandateId: string,
  currentCart: SimpleCart
): Promise<{
  verification: MandateVerification    // signature/expiry/hash via @acg/core/verifyCartMandate
  cartMatches: boolean                 // via @acg/core/mandateMatchesCart
  reason?: string                      // human-readable when cartMatches is false
}>
```

This is **the** demo punchline for "the agent doesn't make decisions by itself." The recording shows: cart built via RAG → mandate signed → mandate URL verifies → before payment, `verifyAgainstCart` re-confirms the cart hasn't drifted. If anything (the agent, an out-of-band edit, a tampering middle layer) changed the cart between signing and pay, this returns `cartMatches: false` and the payment is rejected.

Wiring:
- The demo's payment-acceptance step (built later in `docs/SHOWCASE_PLAN.md` Step 6 — the mock payment network) calls `verifyAgainstCart` directly. **Issue 01 provides the primitive; the wiring happens when the mock payment network lands.**
- The existing `executeCheckout` handler is **not** modified by Issue 01 — it's Path A's alternative (headless place-order via VTEX), kept as an option for merchants who want it but not on the demo path. A future issue wires `verifyAgainstCart` in when that handler is deepened.
- The redirect path (`redirectToCheckout`) is unaffected — once the user lands on VTEX native checkout, drift is no longer observable to us. That path stays as documented in `CONTEXT.md` "Checkout handoff" Path A.

Tests:
- Identical cart → `verification.valid: true`, `cartMatches: true`, no `reason`.
- Item quantity changed → `cartMatches: false`, `reason` mentions which item drifted.
- Item removed → `cartMatches: false`, `reason` mentions item count or specific SKU.
- Total changed (coupon applied after sign) → `cartMatches: false`, `reason` mentions total.
- Mandate expired → `verification.valid: false`, `cartMatches` still computed independently (caller decides whether to gate on either or both).
- Unknown `mandateId` → returns `verification.valid: false` with a `reason` of "mandate not found"; doesn't throw. Lets the caller log/respond rather than crash.

### Grilling progress

Decisions made (2026-05-05 grilling session):

- **In scope:** trust-root fix (Adapter is sole signer; MCP-side signing removed).
- **Two modules** rather than one: `MerchantIdentity` (identity, keys, DID) + `MandateOrchestration` (signing ceremony, persistence, verification). MerchantIdentity has zero callers other than MandateOrchestration and the DID handler today.
- **`@acg/core` stays platform-agnostic:** `KeyStore` interface lives in `@acg/core`; `VBaseKeyStore` lives in the Adapter.
- **Narrow signing surface:** the private key is loaded into the `MerchantIdentity` module's closure but **never returned** to callers. Future KMS migration is a swap-not-rewrite at this seam.
- **Reuse, don't reimplement:** `@acg/core`'s `MerchantIdentity` type, `generateKeyPair`, `createDIDDocument` are reused. The Adapter provides only the VBase storage strategy and the narrow signing wrapper.
- **Tests as we go:** new modules ship with tests in the same PR.

All grilling questions resolved 2026-05-05:

- ~~**Evidence Bundle shape.**~~ ✓ Option A — explicit type from day 1, lives in `@acg/core`, with opaque `metadata` for platform context. See section C.1.
- ~~**Verification on retrieval.**~~ ✓ Always verify on GET; response carries `verification.valid` + `checks` + `didDocumentUrl`. See section F.
- ~~**Cart-drift checking.**~~ ✓ `verifyAgainstCart` primitive in scope. Demo path is Path B (controlled flow), not Path A (VTEX redirect). Mock payment network from `docs/SHOWCASE_PLAN.md` Step 6 wires the primitive into the actual demo. See section G.
- ~~**Coordination with Issue 02 (Cart module).**~~ ✓ Both `signAndPersist` and `verifyAgainstCart` take `SimpleCart`. Issue 02's Cart module returns `SimpleCart`. No coordination concerns; issues land independently. See sections E and G.

### Deferred to follow-up issues (post-demo)

- **`Signer` abstraction in `@acg/core`** — full HSM/KMS-style abstraction (`sign(payload) → signature`). The narrow signing surface in MerchantIdentity sets up this seam without forcing it now. Lands when the first remote signer (AWS KMS, GCP KMS, vault) becomes a real requirement.
- **Key rotation** — DID document publishing multiple verification methods so old mandates verify against the previous public key after a rotation.
- **MerchantIdentity per-environment isolation** — today the workspace is in the domain so `master` and `production` get different DIDs by accident; a real production deployment may want explicit configuration.
- **Migration tooling** for the orphaned MCP-host keys — not needed (those keys signed unverifiable mandates); listed only so it's not re-suggested as a "we should keep these in sync" cleanup.
- **`CheckoutSession` module** — incidental to Issue 01; better extracted alongside the larger checkout handler split (Issue 05 → renumbered, or a new follow-up).

### Architecture review notes (from 2026-05-04 review — historical)

- **Files:** `node/handlers/checkout.ts` (809 lines, 5 handlers), `node/handlers/mandate.ts`, `node/handlers/did.ts`, `@acg/core` (untouched — it's already deep).
- **Problem:** the `handlers/checkout.ts` mixes session lifecycle (VBase `acg-sessions`), mandate persistence (VBase `acg-mandates`), payment-page HTML rendering, URL composition, and cart compression — concerns from three sub-domains (Cart Negotiation, Mandate, Checkout) tangled together. The merchant-side mandate ceremony is barely first-class — `if (mandate) { vbase.saveJSON(...) }` ad-hoc.
- **Solution:** extract `MandateOrchestration` (signing + persistence + retrieval as one module) and, separately when convenient, `CheckoutSession` (VBase-backed session lifecycle). The latter is incidental; the former is the product.
- **Benefits:**
  - **Locality:** merchant-side mandate logic is one module, not "wherever VBase happens to get touched."
  - **Leverage:** `@acg/core` is deep. The merchant-side wrapping deserves the same shape.
  - **Tests:** `MandateOrchestration` against a fake `clients/vbase` and a stub Cart module; today no merchant-side mandate code is tested.

### Comments

**2026-05-05** — Grilling complete (7 questions). All design questions resolved; Status flipped to `ready-for-agent`. Acceptance has seven sections (A–G) covering the full merchant-side ceremony: pluggable storage in `@acg/core`, `VBaseKeyStore` + narrow `MerchantIdentity` in the Adapter, `MandateOrchestration` with `EvidenceBundle` typed in `@acg/core`, removed surfaces (MCP-side signing + unverified write endpoint), demo wiring through the chat tool, always-verify GET, and the `verifyAgainstCart` drift-detection primitive.

`CONTEXT.md` updated inline with new terms (`MerchantIdentity`, sharpened `Evidence Bundle`, sharpened `Checkout handoff` Path A vs Path B, `Cart-drift detection`).

Memory updated with `feedback_test_as_we_go` (tests land alongside code; reuse `@acg/core` exports).

ADR-0001 (`docs/adr/0001-merchant-signing-seam.md`) records the trust-root + pluggable-storage decision: merchant signing keys live only in the Adapter; `@acg/core` stays platform-agnostic; the Shopping Agent never signs. Future architecture reviews referencing this seam should consult ADR-0001 before re-suggesting MCP-side or Surface-side signing.
