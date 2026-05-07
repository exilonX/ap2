# ADR-0003: Mock AP2 payment network as three cryptographic parties — merchant, CP, and network — each with its own DID

- **Status:** accepted
- **Date:** 2026-05-07

## Context

ADR-0001 established the merchant signing seam: `@acg/core` stays platform-agnostic via the `KeyStore` interface, the Adapter contributes `VBaseKeyStore`, the merchant's Ed25519 key never leaves the Adapter, and the merchant `MerchantIdentity` is the single signing surface for CartMandate.

Step 6 of `docs/SHOWCASE_PLAN.md` calls for a **mock AP2 payment network** so the demo can show the full ceremony — CartMandate signed → PaymentMandate signed → network verifies + emits PaymentReceipt — rather than just the merchant-side half. AP2 v0.2's `PaymentMandate` (per the canonical Pydantic at `code/sdk/python/ap2/models/mandate.py`) carries a `user_authorization` JWT signed by a Credentials Provider (CP) on the user's behalf, and the network is a third party that verifies merchant + CP signatures and emits its own signed receipt.

Three concrete questions arose during the 2026-05-07 grilling:

1. **Who signs PaymentMandate?** The spec says the user (or a Credentials Provider attesting via device-tap). The merchant's Adapter cannot sign on the user's behalf without violating ADR-0001's trust separation — the merchant attests to cart correctness, not to user payment authorization. Adding a separate cryptographic identity for "the party that holds the user's payment instruments" is the spec-aligned answer.
2. **Where do mock CP and Network keys live?** The merchant's keys are in VBase via `VBaseKeyStore` (ADR-0001). The same pattern fits CP and Network — separate VBase buckets per party. But that means the package containing the mock logic must remain platform-agnostic (no `@vtex/api` import), and the Adapter wires in the `KeyStore` instances.
3. **One package or two?** Two roles, two distinct cryptographic identities. Bundling them in one package or splitting them?

## Decision

**The mock AP2 ecosystem is modeled as three cryptographic identities, each with its own DID + Ed25519 keypair persisted via the `KeyStore` interface from `@acg/core`.** Concretely:

- **Merchant** — `MerchantIdentity` in the Adapter, backed by `VBaseKeyStore` against bucket `acg-identity` (existing per ADR-0001). Signs CartMandate via `merchant_authorization`. DID published at `GET /_v/acg/.well-known/did.json`.
- **Credentials Provider** — `MockCredentialsProvider` class in a new package `@acg/mock-payment-network`, KeyStore-injected. Signs PaymentMandate's `user_authorization` JWT on the user's behalf (deviation from spec: simple Ed25519 JWS instead of full sd-jwt-vc — ISSUES.md tracks the v1.x upgrade). DID published at `GET /_v/acg/mock-cp/.well-known/did.json`. Adapter wires it with `VBaseKeyStore` against bucket `acg-mock-cp`.
- **Payment Network** — `MockPaymentNetwork` class in the same new package, also KeyStore-injected. Performs the seven-check verification chain (merchant signature, CP signature, hash binding on `transaction_data`, amount consistency, mandate id linking, both expiries) and emits a signed `PaymentReceipt` evidencing the decision either way. DID published at `GET /_v/acg/mock-network/.well-known/did.json`. Adapter wires it with `VBaseKeyStore` against bucket `acg-mock-network`.

**One package, two classes.** The mock CP and Network ship together as `@acg/mock-payment-network` — they're conceptually "the mock external world" for ACG's demo, and bundling them halves the package count without conflating their cryptographic identities (separate keypairs, separate DIDs). When (if) production CP and Network adapters land, each becomes its own package with its own concrete implementation; the interface stays.

**No `@vtex/api` import in the mock package.** Same architectural property as `@acg/core` per ADR-0001: the mock package speaks `KeyStore`, the Adapter speaks `VBaseKeyStore`. A non-VTEX adapter could reuse `@acg/mock-payment-network` unchanged.

## Consequences

**What becomes easier:**

- **The recording shows three cryptographically distinct parties.** Each has its own DID document at a different URL. A reviewer of the case study can hit each `.well-known/did.json` independently and verify any signed artifact (CartMandate, PaymentMandate, PaymentReceipt) against the appropriate public key. Nothing is fictional — every byte is real.
- **The full AP2 trust chain is recordable.** From cart sign → CP sign → network verify → receipt sign, every step is a discrete artifact persisted under its own VBase bucket and retrievable via its own REST route. Drift detection, network rejection, and approval each emit signed PaymentReceipts (always-emitted invariant).
- **Production swap-in is mechanical.** Replace `MockCredentialsProvider` with a Google Pay / wallet adapter, replace `MockPaymentNetwork` with a Visa / Mastercard adapter — same `signPaymentMandate` / `approvePayment` interface, same calling code in `PaymentOrchestration`. The Adapter never holds CP or Network keys regardless.
- **`@acg/mock-payment-network` is reusable.** A second Adapter (Shopify, BigCommerce) could import it unchanged and run the same demo. Same property `@acg/core` has had since ADR-0001.

**What becomes harder:**

- **Three identities to manage in VBase.** Three separate buckets (`acg-identity`, `acg-mock-cp`, `acg-mock-network`), three separate routes, three separate persistence concerns. Worth the architectural clarity but a real operational surface.
- **The mock package is intentionally limited.** It signs PaymentMandate and emits PaymentReceipts but doesn't simulate 3DS2 step-up, Network risk scoring, or Issuer interaction. Documented in `docs/AP2_COMPLIANCE.md`. Production CP and Network would handle these natively.
- **CP and Network here are colocated processes.** In production they'd be remote services with their own latency, retry, and failure modes. Our `PaymentOrchestration.signAndSubmit` calls them synchronously in-process, which is fine for demo but doesn't model real-world async/error semantics.

**What we gave up:**

- A full sd-jwt-vc representation for `user_authorization`. The cryptographic content (signature over `transaction_data: [hash(CartMandate), hash(PaymentMandateContents)]`) is equivalent to the spec; the representation is simpler. Spec-compliance work tracked in ISSUES.md.
- A user-owned device key signing PaymentMandate. The mock CP signs with its own key, attesting on the user's behalf. The `agent_presence` flags (`agent_involved`, `human_present`) carry the demo's signal that this is an agentic transaction. Real CP integration (Google Pay, etc.) would replace this with TPM/secure-element-backed user authentication.

## Alternatives considered

**A. Merchant signs both CartMandate and PaymentMandate.** Simplest. Single trust root. **Rejected** — collapses the spec's intentional separation between merchant attestation (cart correctness) and user/CP attestation (payment authorization). Loses the "user → network" channel that's the entire point of PaymentMandate per AP2 §4.1.3. Also sets up a confusing case study where "the merchant is also the credentials provider," which isn't what AP2 models.

**B. Single facade with internal opaque keystore, hardcoded keys.** Quickest to ship. **Rejected** — committing keys (even mock) is bad hygiene; the DID document URL would have to be hardcoded too; no persistence story for case-study readers wanting to re-verify after the fact.

**C. Generate ephemeral keys per request.** Each request mints fresh CP and Network identities. **Rejected** — DIDs would change per request, so the published DID document URL wouldn't match the signature on a previously-issued artifact. Anyone hitting `/payment-mandates/<id>` later would see "DID changed, signature invalid." Demo-recordable but the case study's "go fetch the DID and verify yourself" beat would break.

**D. Two separate packages — `acg-mock-credentials-provider` + `acg-mock-payment-network`.** Most spec-aligned (CP and Network are conceptually distinct AP2 roles). **Rejected** for now — doubles the package count and lockfiles for marginal narrative gain. Adopted **as a layer on top of (chosen)**: each role is a separate exported class with its own KeyStore + DID, internal to one package. The structural separation that matters (separate keys, separate DIDs, separate REST routes, separate persistence buckets) is preserved.

**E. Mock CP/Network in `@acg/core` directly.** **Rejected** — `@acg/core` is the *protocol engine* (cryptographic primitives, verification, JCS canonicalization). Adding mock external parties would muddy the boundary; future contributors would lose the "core ships only spec primitives, mocks live alongside" mental model. Same shape as ADR-0001's "VBaseKeyStore lives in the Adapter, not in @acg/core."

## References

- ADR-0001 — Merchant signing seam — establishes the precedent for ADR-0003.
- AP2 v0.2 specification — `docs/ap2-specification-v0.1.md` (will be renamed alongside v0.2 alignment work).
- AP2 v0.2 canonical Pydantic — `https://github.com/google-agentic-commerce/AP2/blob/main/code/sdk/python/ap2/models/mandate.py`.
- `docs/SHOWCASE_PLAN.md` Step 6 — the design goal this implementation realizes.
- `docs/AP2_COMPLIANCE.md` — running ledger of spec-compliance and known deviations.
- `ISSUES.md` 0017+ — post-demo work to harden the deviations (sd-jwt-vc adoption, v0.2 W3C-wrapped CartMandate, IntentMandate, agent_presence dynamic derivation).
