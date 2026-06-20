# Latest changes — context handoff

Snapshot for the next agent picking up the AP2/ACG demo work.
Today: **2026-06-16**. Branch: `main`. Last verified working: text flow
end-to-end in Claude Desktop on `acg--vtexeurope.myvtex.com` against
miniprix's catalog. Iframe ceremony work is in but not yet user-verified.

---

## 2026-06-17 session — iframe correctness + payment selector + real ceremony + card flow (UNCOMMITTED)

Large batch, all on top of the `b666d6a` consent-gating work. **Not committed yet.**
`yarn test` 153/153, adapter `tsc` clean, MCP builds, iframe JS parses. Needs
`vtex link` (adapter changed) **and** Claude Desktop restart (MCP changed).

### Card settlement gate + Netopia connector seeded (latest, MCP-only)
- **Card/redirect no longer fake-fail.** Today the card path placed a real VTEX
  order + ran the real AP2 ceremony, then hit `sendPaymentInfo` which 400s
  ("card number must be not null to generate hash" — we send `fields:{}`); the
  promise rejected into the outer `.catch` and rendered a **red "Payment
  rejected"** that masked the success, and VTEX auto-cancelled the unpaid order.
- **Fix (checkout.html, iframe-only):** in `payChain`, after `placeOrder`
  succeeds, a settlement gate branches on `currentMethodKind`. Only `'direct'`
  (Cash/promissory) runs `sendPaymentInfo`/`authorizeTransaction`. Card/redirect
  **stop after the order + ceremony** and render a new honest green
  **"AP2 verified · settlement pending via connector"** panel
  (`renderPaymentResult({success:true, settlementPending:true})` →
  `renderFinalPanel` settlement-pending branch). Verification checks + artifact
  URLs come from the real `place_order` ceremony. No adapter change.
- **Netopia connector cloned** into `connector-netopia/` (top-level, pinned to
  `768d7ca`, **nested git repo — untracked by AP2 root**). It's a real VTEX PPP
  app on `@vtex/payment-provider@1.4.0`: `paymentProvider/configuration.json` +
  `node/connector/flow/{authorization,settle,cancel,refund}.ts` + `webhook.ts`,
  outbound to Netopia sandbox/mobilPay. This is the path to **real card
  settlement** (replaces the settlement-pending stub above). Some Adyen residue
  (`node/clients/adyenClient.ts`) from the VTEX scaffold. **We had no payment
  connector before this** — the adapter only *calls* VTEX checkout/payment APIs.

### Build wiring fix (important)
- Root `build:mcp` was running bare `npx tsc` and **skipping `copy:apps`**, so
  edits to `src/apps/*.html` never reached `dist/apps/` — and since `dist/apps`
  exists, the `src/apps` runtime fallback never fired. **HTML edits silently
  didn't ship.** Fixed: root `build:mcp` now calls the package `build`
  (`tsc && copy:apps`). This likely means earlier "rebuilt but iframe unchanged"
  confusion was this bug.

### Iframe correctness (checkout.html)
- **Fake-success-on-failure fixed.** `payNow()` now verifies `placeOrder`
  returned a real `order.orderGroup` before chaining; a soft failure (200 +
  `{result:"ERROR…"}`, e.g. CHK0087/ORD009) renders a red failure panel with the
  real reason instead of a green all-checks-pass ceremony. (This is why the
  CHK0087 failure below is now *visible* — the old iframe masked it as success.)
- Denied gateway status → failure panel. Blank-iframe-on-error → shows the error.
- Force-reject link hidden (static + runtime) — it called `payNow(true)` which,
  after the rewrite, would place a real order.

### Four-task batch
1. **Product images fixed** — MCP App iframe CSP blocks external `<img src>`
   (ISSUE 0011). Headless tools forwarded raw CDN URLs; now `embedCartPreviewImages`
   base64-embeds them (`-100-100`) in set/update/placeOrder proxy tools.
2. **"Fără denumire" fixed two ways** — (2a) `document`/`documentType` added to
   MCP `setCustomerProfile` (adapter already forwarded them). (2b) `place_order`
   value-drift re-sync now routes through `Cart.setPaymentData` (re-injects
   buyer identity) instead of a hand-rolled `addPaymentData` that stripped it.
3. **Payment selector** — `set_payment_method` returns full `paymentMethods[]`
   (+`requiresAuthentication`); new no-`_meta.ui` `updatePaymentMethod` MCP tool
   lets the iframe re-cost on change without re-opening a nested panel. Iframe
   renders a `<select>` (Cash default); Pay-Now re-confirms the final choice
   first (also re-syncs payment value → defends ORD009).
4. **Card flow** — (4a) `place_order` now runs the **real** three-party ceremony
   (CP signs PaymentMandate, Network verifies + signs PaymentReceipt, both
   persisted); the iframe's seven checks + PaymentMandate/PaymentReceipt links
   are now REAL, with synth checks only as a soft-fail fallback. (4b) card-group
   selection shows a mock card form; Pay-Now runs a simulated 3DS OTP (redirect
   group → mock provider hand-off) before the chain. Card data never leaves the
   iframe — real card settlement still needs the PPP connector.

### CHK0087 (open — likely demo-data, not a code bug)
- Live test 2026-06-17: `place_order` → `POST /transaction` → **401 CHK0087**
  "authentication required to use a new address". Root cause: VTEX won't let an
  anonymous session attach a *new* address to a profile whose email is a
  **registered account** (`ionel.merca@gmail.com` is almost certainly registered
  on vtexeurope).
- Mitigations shipped: (a) shipping address now sent with `isDisposable: true`
  (`Cart.setShippingAddress`) — the headless bypass so VTEX doesn't attach the
  address to the profile; (b) `place_order` catches CHK0087/401 and returns a
  clear actionable message instead of a 500 stack dump.
- **If it still fails after relink:** test with a guest email NOT registered on
  the store (this confirms the root cause). Real fix for registered shoppers is
  an authenticated `storeUserAuthToken` session — out of scope for the anonymous
  agent flow.

### SHIP TO real address + buyer profile
- `set_payment_method` / `place_order` now return a formatted `shippingAddress`
  AND a `customerProfile` (name/email/phone/document) — `formatShippingAddress`
  + `formatCustomerProfile` in `mappers/cart.ts`. Iframe renders the real
  address in the SHIP TO row (instead of "Address on file MOCK") and a
  Customer/Email/Phone/Document block at the top of the details section so the
  final step confirms who is paying. Blank fields omitted.

### Files touched this session
- `mcp-server/src/apps/checkout.html` (selector, card form, 3DS/redirect overlay,
  real-receipt rendering, success gating, ship-to)
- `mcp-server/src/tools/headless-checkout.ts` (image embed, updatePaymentMethod,
  receipt + shippingAddress payload)
- `mcp-server/src/tools/cart.ts` (setCustomerProfile document field)
- `vtex-io-adapter/node/agent-tools/{place-order,set-payment-method,list-payment-methods}.ts`
- `vtex-io-adapter/node/agent-tools/types.ts` (PaymentMethodOption.requiresAuthentication,
  MandateInfo ceremony fields, ToolEffect.shippingAddress)
- `vtex-io-adapter/node/cart/cart.ts` (isDisposable address)
- `vtex-io-adapter/node/mappers/cart.ts` (formatShippingAddress)
- `package.json` (build:mcp → copy:apps)
- `agent-tools/__tests__/list-payment-methods.test.ts` (requiresAuthentication)

---

## Where we are in the bigger arc

The 4-week showcase plan (`docs/SHOWCASE_PLAN.md`) needs a real
demo-able order placement chain across two surfaces:

- **Storefront chat widget** (`apps/acg-chat-widget`) — primary product
- **Claude Desktop MCP** (`packages/mcp-server`) — dev/demo surface

Both must place real VTEX OMS orders, sign AP2 CartMandates over the
cart, and surface a visible ceremony to the user. The widget side is
mostly polished; the Claude Desktop iframe side is the one we just
worked on intensively.

---

## Recent commits (most recent first)

### `b666d6a` mcp+adapter: gate placeOrder behind iframe Pay Now click

**Why.** Previous commit (`8ababaf`) attached the iframe to `placeOrder`,
but Claude Desktop's LLM auto-chained `placeOrder` → `sendPaymentInfo`
→ `authorizeTransaction` in a single turn the moment the user said "hai
la checkout". By the time the iframe appeared the order was already
authorized — it became a post-hoc receipt, not a consent UI. The user
explicitly wanted to press a Pay Now button before commitment.

**What changed.**

- Moved `_meta.ui.resourceUri = ui://acg-checkout/index.html` from the
  MCP `placeOrder` tool to the MCP `setPaymentMethod` tool. Iframe now
  opens one step earlier, in "consent" mode.
- `adapter/agent-tools/set-payment-method.ts` returns `cartPreview` +
  `selectedPayment` (id/name/group) so the iframe can render `Pay
  10.08 RON · Cash on delivery` on the button.
- Added `selectedPayment?: PaymentMethodOption` to `ToolEffect` in
  `agent-tools/types.ts`.
- MCP tool descriptions for `setPaymentMethod`/`placeOrder`/
  `sendPaymentInfo`/`authorizeTransaction` were hardened to tell the
  LLM to **STOP** at `setPaymentMethod` and that the latter three are
  "called BY THE IFRAME — do not call from chat directly".
- `mcp-server/src/apps/checkout.html` rewrite:
  - `populateCheckout()` handles the consent payload (no mandate yet)
    — shows AP2 section as `(will be generated on Pay Now)`, replaces
    the demo's MOCK card-on-file row with the real `selectedPayment.name`.
  - Pay Now button stays enabled in consent mode and the click handler
    (`window.payNow`) was rewritten to chain three `tools/call` JSON-RPC
    requests: `placeOrder` → `sendPaymentInfo` → `authorizeTransaction`.
    The mandate panel populates from the `placeOrder` result mid-chain;
    the 7-check ceremony animates with all checks passing once
    `authorizeTransaction` returns.
  - The original "already-placed" branch (`data.order.orderGroup`
    present) is kept as back-compat for direct `placeOrder` calls from
    chat or curl.

**Status.** Code shipped, builds clean, 153/153 adapter tests green.
**NOT YET USER-VERIFIED** — the user needs to `npm run build:mcp`,
restart Claude Desktop, and `vtex link` from the adapter before they
can test the new flow.

### `8ababaf` mcp+adapter: restore Claude Desktop checkout iframe on placeOrder

**Why.** Headless migration (`1d47900`) deleted `checkoutInChat` +
`executePayment`. `checkout.html` survived under `mcp-server/src/apps/`
but nothing surfaced it — Claude Desktop showed only text. User wanted
the ceremony widget back.

**What changed.**

- Registered `ui://acg-checkout/index.html` as an MCP App resource
  (same pattern as `products.html`).
- Initially attached `_meta.ui` to `placeOrder` (later moved — see
  `b666d6a` above).
- `buildIframePayload()` translates the adapter's `MandateInfo` +
  `CartPreviewData` into the iframe's expected shape
  (`cart.items[]`, `mandate.{id,merchantDid,cartHash,…}`, `order.*`).
- `adapter/agent-tools/place-order.ts` adds `cartPreview` from the
  already-fetched snapshot, no extra VTEX call.
- `checkout.html` `populateCheckout()`: when `data.order.orderGroup`
  is present, hide Pay Now + on-file section and auto-run the 7-check
  ceremony with all checks passing (every CartMandate that survives
  VTEX's `/transaction` call passes every check by construction).
- `renderFinalPanel()` shows "Mandate verified · VTEX order
  `{orderGroup}`" with an admin URL link.

### `7d2211a` fix(authorize_transaction): use mandatePatch in the unclear-status fallback

Hot-fix for a `vtex link` build failure: line 356 of
`authorize-transaction.ts` had `mandate: buildMandatePatch(…)` instead
of `mandatePatch: …`. Local `tsc` cache hid it; VTEX's node@4.x
builder was strict.

### `5bac77d` adapter+widget+mcp: surface real order placement on MandateBadge

Phase C of the widget integration. Extended `MandateInfo` with
`orderGroup`/`transactionId`/`gatewayStatus`; widget's
`PaymentCeremony.tsx` detects `orderGroup` and renders a new
`PlacedOrderConfirmation` panel (admin link + mandate retrieval URL).
Introduced dual channels on `ToolEffect`: `mandate?: MandateInfo`
(full) + `mandatePatch?: Partial<MandateInfo> & { mandateId: string }`
(overlay) so `authorize_transaction` can refine the mandate
`gatewayStatus` without owning the full envelope.

### `712d7c4` adapter+widget+mcp: surface payment methods as pill buttons

Phase B. `list_payment_methods` returns `paymentMethods[]` structured.
Widget added `PaymentMethodPills.tsx` — pill buttons sub mesaj,
clicking emits `"Plătesc cu {name} (id: {id})"` as the canned next
turn. Claude Desktop gets a numbered list (no UI extension at that
time for this tool).

### `bb4ef56` adapter: index mandate by orderGroup for PPP connector lookup

Phase A. New VBase bucket `acg-order-mandate-index` keyed by
`orderGroup` — stores `cartMandateId` + `transactionId` + `signedBy` so
a future PPP connector can look up the mandate during its `authorize`
callback. Added `GET /_v/acg/mandates/by-order/:orderGroup` route. The
seam was chosen over `orderForm.customData` (requires appId
pre-registration + only per-field PUT) and Masterdata (schema
lifecycle pain).

---

## Current end-to-end behavior

### Text-only flow (Claude Desktop, today, no iframe involvement)

Verified working as of `1d47900`:

1. `browseProducts` (search) → image cards
2. `addToCart` → cart updated
3. `setCustomerProfile` + `setShippingAddress` → cart preconditions OK
4. `listPaymentMethods` → numbered text list (e.g. `1. Cash (id: 47)`)
5. User picks → `setPaymentMethod` → cart total updated
6. `placeOrder` → CartMandate signed inline (auto-mandate path) +
   real VTEX transaction created. `acg-orderform-state/{orderFormId}`
   carries `cartMandateId` + `transactionId` + `orderGroup`.
   `acg-order-mandate-index/{orderGroup}` carries the back-reference.
7. `sendPaymentInfo` → POST to `{account}.vtexpayments.com.br/.../payments`
8. `authorizeTransaction` → POST to `.../authorization-request`,
   for Cash returns `status: 8 / statusDetail: Approved`.

Latest successful order observed in logs: `1640030533648` (mandate
`mandate-f208b41f6a598684`, transaction `F993BF32C2C24397AEFD360B8694DD7D`).

### Iframe consent flow (intended, NOT YET USER-VERIFIED)

After `b666d6a` + `npm run build:mcp` + Claude Desktop restart:

1. Steps 1–4 same as above.
2. `setPaymentMethod` returns → Claude Desktop opens `checkout.html`
   iframe with cart + Pay Now button labeled `Pay 10.08 RON · Cash on
   delivery` + AP2 placeholder `(will be generated on Pay Now)`.
3. LLM replies with one line ("Apasă Pay Now…") and stops — does NOT
   call placeOrder/send/authorize.
4. User clicks Pay Now in iframe.
5. Iframe `payNow()` chains three `tools/call`:
   `placeOrder` → fills the AP2 panel with real `cartHash` /
   `signedBy` / `mandateUrl`;
   `sendPaymentInfo`;
   `authorizeTransaction` → final.
6. 7-check ceremony animates; final panel shows "Mandate verified ·
   VTEX order `{orderGroup}`" + admin link + CartMandate retrieval URL.

---

## What still needs verification / improvement

### Critical: user-verify the iframe flow

The user has not yet rebuilt + relinked since `b666d6a`. They need to:

```
npm run build:mcp
# restart Claude Desktop to reload the MCP server
cd packages/vtex-io-adapter && vtex link
```

Then run the same flow as before and confirm:

- Iframe actually opens after `setPaymentMethod` (not after `placeOrder`).
- LLM stops after `setPaymentMethod` instead of auto-chaining.
- Pay Now button works and animates the ceremony.
- All three `tools/call` from inside the iframe succeed.

If the LLM still auto-chains despite the description hardening, the
fallback is to disable `placeOrder`/`sendPaymentInfo`/
`authorizeTransaction` from the LLM-callable tool surface and ONLY
expose them via `tools/call` from the iframe (probably done by not
calling `server.tool(...)` for them but registering them differently —
needs MCP SDK investigation).

### Cleanup nits in `checkout.html`

- The `force-reject` link still calls `payNow(true)` — the new
  `payNow` ignores the arg, so it just runs as a normal Pay Now. Hide
  the link in consent mode.
- The "Or use VTEX standard checkout" link still uses
  `data.checkoutUrl`. In consent mode this points at the storefront
  checkout `/checkout/?orderFormId=…`, which IS useful as an escape
  hatch — keep it but verify the URL is right.
- `payNow` doesn't currently disable the button visually during the
  3-step chain beyond the text change — add an in-flight spinner or
  the disabled state so the user can't double-click.

### Things tested in production logs but worth re-checking

- `sendPaymentInfo` response is `<empty>` from the gateway (logs:
  `← sendPayments 1664ms response=`). For Cash this is normal, but
  for other methods we may want to surface the gateway response in
  the iframe step label.
- `authorize_transaction` for Cash returns `status: 8` → "approved"
  but the order is "payment-pending" in OMS until the merchant marks
  it paid. The iframe shows "approved" which is technically correct
  per gateway response — clarify in the result-panel copy if it
  confuses demo viewers.

### Open items NOT covered by these commits

- **Card direct flow** (Visa `2`, Mastercard `4`) — would need Secure
  Proxy + 3DS challenge UI inside the iframe. Out of scope until the
  PPP connector lands.
- **Redirect methods** (Mokka `204`, PayPal) — `gatewayStatus:
  pending` path is plumbed (`authorize_transaction` maps it) but no
  redirect-handling UI yet.
- **IntentMandate / PaymentMandate / PaymentReceipt** — `docs/AP2_COMPLIANCE.md`
  lists these as v1.x scope. Today only `CartMandate` is real; the
  iframe's "PaymentMandate" + "PaymentReceipt" labels in the 7-check
  list are mocked as all-passing.
- **PPP connector** — Phase A wrote the `acg-order-mandate-index`
  seam but no actual connector consumes it yet. That's a separate
  PRD; see `.scratch/` or `docs/SHOWCASE_PLAN.md` for status.
- **Widget side iframe** — the widget already has
  `PlacedOrderConfirmation` + `PaymentMethodPills`. The Claude Desktop
  iframe work in `b666d6a` does NOT have a widget counterpart. If we
  want the widget to also gate `placeOrder` behind a click, we'd add
  a similar Pay Now UI to the widget (not done; widget's current UX is
  "LLM places order, widget shows proof badge").

---

## Key file map for the next agent

- **Adapter checkout tools** —
  `packages/vtex-io-adapter/node/agent-tools/{list-payment-methods,set-payment-method,place-order,send-payment-info,authorize-transaction}.ts`
- **ToolEffect shape** —
  `packages/vtex-io-adapter/node/agent-tools/types.ts`
- **Adapter HTTP handlers wrapping the tools** —
  `packages/vtex-io-adapter/node/handlers/headless-checkout.ts`
- **Adapter routes** — `packages/vtex-io-adapter/node/service.json` +
  wiring in `node/index.ts`
- **MCP tools (proxy to adapter)** —
  `packages/mcp-server/src/tools/headless-checkout.ts`
- **MCP iframe (the actual checkout.html the user sees in Claude
  Desktop)** — `packages/mcp-server/src/apps/checkout.html`
- **Widget components** — `apps/acg-chat-widget/react/components/{PaymentMethodPills,PaymentCeremony,MandateBadge}.tsx`
- **Mandate persistence + lookup** —
  `packages/vtex-io-adapter/node/mandates/mandate-orchestration.ts`
  (buckets: `acg-mandates`, `acg-orderform-state`,
  `acg-order-mandate-index`)
- **AP2 core (JCS + Ed25519)** — `packages/core/`

## How to run things

```
# Adapter typecheck + tests (from packages/vtex-io-adapter)
yarn lint && yarn test       # 153/153 expected

# MCP + shared build (from repo root)
npm run build:mcp

# Sync shared types into adapter (auto-runs as prelink)
npm run sync-types

# Deploy adapter to live workspace
cd packages/vtex-io-adapter && vtex link
```

The MCP server is wired into Claude Desktop via
`claude_desktop_config.json` — restarting Claude Desktop reloads the
built `dist/index.js`. The user has already configured this once.
