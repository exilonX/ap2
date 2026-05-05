# ADR-0001: Merchant signing seam — keys live only in the Adapter; `@acg/core` stays platform-agnostic

- **Status:** accepted
- **Date:** 2026-05-05

## Context

The Cart Mandate ceremony is the primary product. AP2's trust model assigns one specific role — the Merchant Endpoint — the responsibility of signing mandates with the merchant's private key. Other roles (Shopping Agent, Verifier, Credentials Provider) **must not** hold merchant signing material; the entire dispute-resolution and fraud-detection story rests on this separation.

Three forces shaped this decision:

1. **A live trust-root bug.** Before this ADR was adopted, the codebase carried two independent merchant identities for the same merchant: the Adapter generated one Ed25519 keypair in VBase and served the public half via `did:web:{domain}`, while the MCP server generated a *different* keypair on the local filesystem and used **that** to sign Cart Mandates which it then POSTed to the Adapter for unverified persistence. Mandates signed today could not be verified against the published DID; the AP2 verification beat in the demo would have silently failed. This bug was the proximate cause for revisiting the architecture.

2. **A platform-agnostic core is load-bearing for the sale story.** `@acg/core` is the reusable AP2 engine — JCS canonicalization, DID, Ed25519 signing, JWT mandate creation, with 68 tests. The intent is that future platform adapters (Shopify, custom commerce stacks) plug into `@acg/core` the same way the VTEX Adapter does. If `@acg/core` learns about VBase, every other platform inherits that dependency.

3. **Production signing will eventually move to HSM/KMS.** Real merchants running this in production won't keep Ed25519 private keys in their application's storage layer indefinitely. The seam where signing happens needs to be shaped so that swapping in AWS KMS, GCP KMS, HashiCorp Vault, or an HSM is a swap-not-rewrite operation.

## Decision

**The Merchant Endpoint (the VTEX IO Adapter, `vtexeurope.acg-adapter`) is the sole holder of merchant signing material and the sole site of merchant signing.** Concretely:

- **`@acg/core` owns the cryptographic primitives and a `KeyStore` interface.** The interface has just two methods (`read()` and `write()`). `@acg/core` ships `FilesystemKeyStore` and `EnvKeyStore` reference implementations and never imports any platform-specific package (`@vtex/api`, AWS SDKs, etc.).
- **The Adapter contributes `VBaseKeyStore`.** It implements `@acg/core`'s `KeyStore` interface against VTEX's VBase. The Adapter is the only place that ever knows merchant keys are stored in VBase.
- **The Adapter's `MerchantIdentity` module exposes a narrow signing surface** — `getDID()`, `getDIDDocument()`, `signCartMandate(cart)` — and never returns the private key to callers. The key is loaded into module-scope memory once via the `KeyStore`; every signing operation runs through a method that scopes the key to that single operation.
- **Shopping Agent surfaces** — the MCP server, the chat handler's tool executor, the storefront chat widget — **never hold merchant keys, never sign locally, and never have access to a `KeyStore`**. They obtain signed mandates by calling the Adapter's `MandateOrchestration.signAndPersist` operation.

## Consequences

**What becomes easier:**

- Mandates are now actually verifiable. The key that signs is the key the DID document publishes. The demo's verification beat works on the first take.
- Adding a new storage backend is mechanical: implement `KeyStore`, wire it in. KMS, HSM, vault, encrypted-app-settings are all the same shape.
- Adding a new platform adapter (Shopify, BigCommerce, custom) reuses `@acg/core` unchanged. Each platform contributes its own `KeyStore` and its own `MerchantIdentity` wrapper.
- The trust-root invariant is enforceable by code review: any import of `@acg/core/createCartMandate` outside the Adapter's `MerchantIdentity` module is a red flag a reviewer can catch with a single grep.
- A compromised Shopping Agent cannot forge mandates. The blast radius of any chat-side bug is bounded because the agent never had the key to begin with.

**What becomes harder:**

- Surfaces cannot sign offline. A chat widget without backend connectivity cannot produce a signed mandate. This is a feature, not a bug, but it does mean any future "sign and queue locally" optimization has to route through the Adapter.
- Onboarding a new platform requires implementing `KeyStore` (a real piece of work) and a `MerchantIdentity` wrapper. Cannot just call an `@acg/core` helper and be done.
- `@acg/core/loadOrCreateIdentity` becomes `loadOrCreateIdentity(domain, store: KeyStore)` instead of `(domain, path: string)`. A backwards-compatibility wrapper bridges the change for the demo cycle; longer-term, the wrapper goes away.

**What we gave up:**

- The in-process MCP-side signing path that previously existed in `packages/mcp-server/src/tools/checkout.ts`. It is deleted in Issue 01.
- The `POST /_v/acg/mandates` endpoint that accepted arbitrary pre-signed JSON. It is deleted in Issue 01 — its existence allowed any caller to pollute the mandate store with unsigned (or third-party-signed) bytes.
- The convenience of "any process with the merchant domain string can produce a mandate." That convenience was incompatible with the AP2 trust model.

## Alternatives considered

**A. Keep MCP-side signing; unify keys via a "give me the merchant private key" endpoint on the Adapter.** Would require exposing merchant private keys over HTTP from the Adapter to the MCP server. This is a direct violation of the AP2 trust model regardless of how the endpoint is authenticated — the moment a Shopping Agent process holds merchant private keys, the model breaks. Rejected.

**B. Put `VBaseKeyStore` in `@acg/core` under a conditional dependency.** Would force `@acg/core` to declare a peer dependency on `@vtex/api`. Future platform adapters (Shopify, custom) would inherit the VTEX dep transitively even though they never use it. Breaks the platform-agnostic property that's load-bearing for the sale story. Rejected.

**C. Encapsulated signing inside `MerchantIdentity` without a `KeyStore` abstraction.** Hides keys at the module level (good) but couples `MerchantIdentity` to one specific storage backend (bad). Doesn't address the multi-platform case or the future KMS migration. Half-measure. Rejected as a standalone option but adopted **as a layer on top of** the `KeyStore` abstraction — `MerchantIdentity`'s narrow signing surface is the encapsulation; `KeyStore` is the swappable storage underneath.

**D. Full `Signer` abstraction in `@acg/core` from day one** (a `sign(payload) → signature` interface alongside `KeyStore`, anticipating remote signers like KMS). Cleaner long-term but touches `@acg/core/createCartMandate`'s signature and its 68 tests for zero current benefit. Deferred — `MerchantIdentity`'s narrow signing surface gives us the seam to add this when KMS becomes a real requirement, without changing any caller.

## References

- AP2 v0.1 specification — `docs/ap2-specification-v0.1.md`
- AP2 compliance status — `docs/AP2_COMPLIANCE.md`
- The grilling session that produced this decision — `.scratch/architecture-deepening/issues/01-mandate-orchestration.md` ("Grilling progress" section)
- Domain glossary entries: `MerchantIdentity`, `DID`, `Evidence Bundle` in `CONTEXT.md`
