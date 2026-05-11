# Demo Storyboard — Agent Commerce Gateway (AP2 case study)

**Target length:** 3:30–4:00. Hard cap 4:00.
**Format:** **voice + captions paired**. Voice carries the narrative; captions reinforce the technical detail (signature hashes, DID URLs, JSON fields). Both ship together.
**Primary surface:** Claude Desktop (most iconic for the AP2 / agentic-commerce story; cleanest to record).
**Secondary surface:** storefront chat widget (5s B-roll near the close to show "same backend, two surfaces").

## Production decisions (locked 2026-05-08)

- **Voice:** present from take 1 — not a second pass. Each scene has a script broken into beats with timestamps. Read the script aloud while watching the silent screen capture in your editing tool.
- **Captions:** English only, paired with voice. Caption appears on screen at the same beat as the voice line that delivers it. Caption text is *shorter* than the spoken line — caption is for skimmers/mute viewers, voice carries the full narrative.
- **User-typed Romanian text** stays Romanian for authenticity (e.g. *"vreau o camasa"*). The voice line in English narrates around it ("I ask the agent in Romanian for a shirt…").
- **Camera:** screen-only, no face cam. Focus stays on the artifacts.
- **Workspace:** `acg / miniprix` (the current working setup) — already wired end-to-end with RON pricing, Romanian catalog, real products.

## Recording workflow

The pro workflow is **screen-first, voice-over-second**, even when you've decided voice is part of the final cut:

1. **Capture screen silently** following the scene actions. Don't worry about pace yet — you'll cut to script timing in post.
2. **Import into DaVinci Resolve / CapCut.** Cut every dead second, tighten transitions to roughly match the scene timings below.
3. **Read the voice script aloud while watching playback.** Multiple takes per scene if needed. Record with a half-decent USB mic in a quiet room — no studio gear required.
4. **Overlay captions** at the timestamps below. Captions appear *on the beat* the voice lands, hold for ~2s after, then fade.
5. **Mix** — voice front, ambient/music (if used) at –18 dB so the words sit clearly above.

Word budget at conversational pace (~2.5 words/second after natural pauses):

| Scene | Duration | Spoken word budget |
|---|---|---|
| 1 — Cold open | 15s | ~30 words |
| 2 — Live shopping | 45s | ~80 words (long action gaps for tool calls) |
| 3 — Signing ceremony | 75s | ~120 words (animation reveals need silence) |
| 4 — Independent verification | 35s | ~65 words |
| 5 — Rejection branch | 35s | ~65 words |
| 6 — Architecture + widget | 25s | ~50 words |
| 7 — Compliance + close | 10s | ~22 words |
| **Total** | **~3:40** | **~432 words spoken** |

---

## Pre-flight checklist

Before you hit record, verify each of these:

- [ ] Adapter linked to fresh workspace (`vtex link` from `packages/vtex-io-adapter`)
- [ ] App settings populated in VTEX Admin: `acgAllowedOrigins`, `acgAuthToken`, LLM keys, Pinecone keys
- [ ] Claude Desktop config has `ACG_AUTH_TOKEN` matching the adapter setting; fully quit + reopen Claude Desktop after the change
- [ ] MCP server built (`npm run build` in `packages/mcp-server`) — `dist/apps/checkout.html` is the latest version with the on-file panel and the force-reject link
- [ ] All three `.well-known/did.json` URLs return JSON in your browser:
  - `https://acg--miniprix.myvtex.com/_v/acg/.well-known/did.json`
  - `https://acg--miniprix.myvtex.com/_v/acg/mock-cp/.well-known/did.json`
  - `https://acg--miniprix.myvtex.com/_v/acg/mock-network/.well-known/did.json`
- [ ] Storefront has shipping address + customer profile pre-set on the demo cart
- [ ] Browser tabs ready in a separate window: the three DID document URLs pre-loaded, JSON-prettified
- [ ] Screen resolution locked to 1920×1080 or 16:9 equivalent
- [ ] Hide the dock / taskbar / notifications. Do Not Disturb on.
- [ ] Run a happy-path dry run end-to-end before the real take. Force-reject too.

## Equipment notes

- **Recording tool:** OBS or built-in screen recorder. 1080p, 30fps minimum. Mouse cursor visible.
- **Microphone:** USB mic in a quiet room is fine. Avoid built-in laptop mic — its high-frequency noise floor reads as "amateur."
- **Editing tool:** DaVinci Resolve (free) or CapCut. Both handle voice tracks + caption tracks cleanly.
- **Caption font:** sans-serif, ~32–36px at 1080p, white text with thin black outline or semi-transparent black background.
- **Caption position:** lower third, ~80px above the bottom edge.
- **Caption timing:** appears on the beat, stays for ~2s after the voice line ends, then fades.

---

## Scene-by-scene

Each scene below uses this format per beat:

> **(timestamp)** — *action description*
> **VOICE:** "exact words to read aloud"
> **CAPTION:** what appears on screen

---

### Scene 1 — Cold open (0:00 → 0:15)

**Visual:** Black background fading to a still of the merchant DID document JSON in a browser, key fields highlighted (`id`, `publicKeyHex`). Then crossfade to the Claude Desktop window with cursor in the chat input.

> **(0:00-0:03)** — *Black fade-in to DID JSON view.*
> **VOICE:** "An AI agent shopping on a real VTEX store."
> **CAPTION:** **Agent commerce on VTEX.**

> **(0:03-0:09)** — *Camera pans across the DID JSON, lingering on `publicKeyHex`.*
> **VOICE:** "What makes this different from every other AI-shopping demo: every signature is real Ed25519."
> **CAPTION:** **Every signature is real EdDSA.**

> **(0:09-0:15)** — *Crossfade to Claude Desktop, cursor blinking in chat input.*
> **VOICE:** "Every artifact is published. Anyone can verify the chain themselves."
> **CAPTION:** **Every artifact is publicly verifiable.**

---

### Scene 2 — Live agent shopping (0:15 → 1:00)

**Visual:** Claude Desktop window. Type user message, tool calls fire, iframe renders products.

> **(0:15-0:21)** — *Type "vreau o camasa si niste pantaloni pentru barbati" into Claude Desktop.*
> **VOICE:** "I ask the agent in Romanian for a shirt and some pants."
> **CAPTION:** **User → agent (Romanian):** *vreau o camasa si niste pantaloni pentru barbati*

> **(0:21-0:30)** — *Tool calls expand, browseProducts × 2 fire.*
> **VOICE:** "The MCP server proxies the request to a VTEX IO adapter that hits the real catalog."
> **CAPTION:** **MCP tool call: `browseProducts` → VTEX IO → live catalog**

> **(0:30-0:38)** — *Product cards render in iframes inside the chat — 3 shirts, 3 pants.*
> **VOICE:** "Real merchant. Real products. Real RON pricing — none of this is mocked."
> **CAPTION:** **Real catalog. Real prices.**

> **(0:38-0:50)** — *Click "Add to cart" on one shirt + one pair of pants from the product cards.*
> **VOICE:** "The agent reads the results, adds two items to a real shopping cart, and renders the cart inline."
> **CAPTION:** **Cart preview rendered server-side from VTEX OrderForm.**

> **(0:50-1:00)** — *Cart preview card visible, totals shown.*
> **VOICE:** "Same cart you'd see if you opened VTEX checkout in another tab — there's only one cart, shared across surfaces."
> **CAPTION:** **One orderForm, all surfaces.**

---

### Scene 3 — Checkout + signing ceremony (1:00 → 2:15)

**Visual:** User types "checkout"; iframe opens with AP2 Security panel; Pay Now button enabled; click triggers 4-step animated ceremony.

> **(1:00-1:08)** — *Type "checkout"; iframe opens; AP2 Security panel appears.*
> **VOICE:** "When I say checkout, the merchant signs a CartMandate — a verifiable digital credential committing to this exact cart."
> **CAPTION:** **Merchant signs CartMandate (Ed25519, JCS-canonicalized).**

> **(1:08-1:18)** — *Camera lingers on AP2 Security panel — mandate ID, DID, cart hash visible.*
> **VOICE:** "The merchant's DID, the cart hash, the timestamp. All cryptographically committed."
> **CAPTION:** **`did:web:acg--miniprix.myvtex.com` · cart_hash: 78e4a8f…**

> **(1:18-1:22)** — *Click Pay Now button. Ceremony Step 1 reveals with green check.*
> **VOICE:** "I click Pay Now. Step one: re-verify the signed cart hasn't drifted from the live cart."
> **CAPTION:** **1. Re-verify CartMandate against current cart.**

> **(1:22-1:32)** — *Step 2 reveals with green check.*
> **VOICE:** "Step two: the Credentials Provider signs the PaymentMandate. The transaction_data binds the cart hash to the payment hash — neither can be tampered without invalidating both."
> **CAPTION:** **2. CP signs PaymentMandate. transaction_data = [hash(Cart), hash(Payment)]**

> **(1:32-1:52)** — *Step 3 reveals; the 7-check checklist animates in at 80ms intervals. Don't speed up.*
> **VOICE:** "Step three: the Network independently verifies the chain. Seven separate checks — both signatures, the hash binding, the amount, the mandate ID linking, both expiries."
> **CAPTION:** **3. Network verifies — 7 checks: signatures · hash binding · amount · expiries**

> **(1:52-2:02)** — *Step 4 reveals; "Order placed" with mock order ID.*
> **VOICE:** "Step four: the Network signs the PaymentReceipt. The order is placed."
> **CAPTION:** **4. Order placed. Network signs the PaymentReceipt.**

> **(2:02-2:15)** — *Final "Payment authorized" panel; three artifact links visible.*
> **VOICE:** "Three parties just cryptographically attested. Three artifact links below — let's open them."
> **CAPTION:** **All three parties signed. Three artifact links.**

---

### Scene 4 — Independent verification (2:15 → 2:50)

**Visual:** Click each artifact link in turn; browser tabs open with JSON; key fields highlighted.

> **(2:15-2:23)** — *Click CartMandate link; tab opens JSON; highlight `verification.valid: true` and `signedBy`.*
> **VOICE:** "The CartMandate. `verification.valid: true`. Signed by the merchant's DID."
> **CAPTION:** **CartMandate · verification.valid: true · `did:web:acg--miniprix.myvtex.com`**

> **(2:23-2:31)** — *Click PaymentMandate link; tab opens JSON; highlight `user_authorization` and `cpDID`.*
> **VOICE:** "The PaymentMandate. `user_authorization` signed by the Credentials Provider."
> **CAPTION:** **PaymentMandate · `user_authorization` · `did:web:…:mock-cp`**

> **(2:31-2:40)** — *Click PaymentReceipt link; tab opens JSON; highlight `approval_status: "approved"`, all 7 checks true, `networkDID`.*
> **VOICE:** "The PaymentReceipt. All seven checks true. Signed by the Network's key."
> **CAPTION:** **PaymentReceipt · 7/7 checks · `did:web:…:mock-network`**

> **(2:40-2:50)** — *Open all three `.well-known/did.json` URLs side-by-side in a split view. Three different `publicKeyHex` values visible.*
> **VOICE:** "Three cryptographic identities. Three published keys. Anyone with these URLs can verify the chain themselves."
> **CAPTION:** **Three DIDs. Three keys. Independently verifiable.**

---

### Scene 5 — The rejection branch (2:50 → 3:25)

**Visual:** Reset to Claude Desktop; new cart; click `(force reject — staging only)` link; ceremony plays with one ✗; open rejection receipt JSON.

> **(2:50-2:55)** — *New cart, "checkout" typed, iframe re-opens.*
> **VOICE:** "Now — what happens when something goes wrong?"
> **CAPTION:** **What if a check fails?**

> **(2:55-3:01)** — *Click the small grey "(force reject — staging only)" link below Pay Now.*
> **VOICE:** "In production this could be insufficient funds, a 3DS step-up failure, or a fraud flag. Here I force the Network to fail one check."
> **CAPTION:** **Force-reject mode (staging only).**

> **(3:01-3:13)** — *Ceremony plays: steps 1+2 succeed, step 3 reveals 6 ✓ + 1 ✗ on `payment_mandate_not_expired`, step 4 marks failed.*
> **VOICE:** "Steps one and two succeed. Step three reveals six green checks and one red. The Network rejected the chain."
> **CAPTION:** **6 ✓ + 1 ✗ — Network rejected.**

> **(3:13-3:18)** — *Final panel: "Payment rejected · Reason: payment mandate has expired" with PaymentReceipt link.*
> **VOICE:** "The receipt link is right there. Watch this — open it."
> **CAPTION:** **PaymentReceipt artifact still emitted →**

> **(3:18-3:25)** — *Click the receipt; JSON opens; highlight `approval_status: "rejected"` AND `verification.valid: true` at the top level.*
> **VOICE:** "Payment rejected. But the receipt itself is cryptographically valid. The Network *signed the rejection*. Today a decline is a string from the acquirer. Tomorrow it's a signed artifact anyone can verify."
> **CAPTION:** **approval_status: rejected · verification.valid: true · Always-emit invariant.**

---

### Scene 6 — Architecture + secondary surface (3:25 → 3:50)

**Visual:** Diagram with three boxes (Merchant / CP / Network); cut to widget B-roll.

> **(3:25-3:35)** — *Excalidraw / tldraw diagram of the three parties + DIDs + arrows.*
> **VOICE:** "The mock Credentials Provider and Network here are production swap-ins. Replace one class with Google Pay. Replace the other with Visa. The orchestration code doesn't change."
> **CAPTION:** **Mock CP + Network → swap-in for Google Pay, Visa, Mastercard.**

> **(3:35-3:45)** — *Cut to storefront chat widget showing the same product search.*
> **VOICE:** "And the same backend powers a chat widget on the storefront. Tomorrow, a ChatGPT or UCP surface — same engine."
> **CAPTION:** **One backend. Many surfaces. Claude Desktop · widget · ChatGPT next.**

> **(3:45-3:50)** — *Hold on the widget showing product cards.*
> **VOICE:** *(silence — let the widget speak for itself)*
> **CAPTION:** *(none — just the visual)*

---

### Scene 7 — Compliance + close (3:50 → 4:00)

**Visual:** Plain text on dark background. Final frame.

> **(3:50-3:55)** — *Text appears: AP2 v0.2 · EdDSA · JCS · did:web.*
> **VOICE:** "AP2 v0.2 spec-faithful where it lands the demo. Documented deviations on the path to v1."
> **CAPTION:** **AP2 v0.2 · EdDSA Ed25519 · JCS · did:web · Deviations: ISSUES.md 0017–0020**

> **(3:55-4:00)** — *Repo URL prominent.*
> **VOICE:** "Open source. Build agent commerce that's auditable by design."
> **CAPTION:** **github.com/exilonX/ap2**

Hold final frame for 1.5s before fade out.

---

## Editing notes

- **Cut every dead second.** If Claude is thinking for 2.3s before a tool call appears, jump-cut to the result. The voice script assumes tight cuts.
- **Speed up scrolling** in the JSON-view scenes (4, 5) to 1.5×. The viewer doesn't need to read every byte; they need to see the highlighted fields.
- **Highlight key fields** in the JSON with a colored rectangle overlay or zoom-in. Don't expect viewers to spot `verification.valid: true` in a 200-line JSON dump.
- **The 80ms-staggered 7-check reveal** in scene 3 is the visual centerpiece. Don't speed it up. If anything, slow it slightly (0.85× speed clip) so the voice line fits naturally.
- **Voice mix:** front-and-center. If using music, instrumental only, –18 dB, cut entirely for scene 5's punchline (the contradiction lands harder in silence with just the voice).
- **Caption styling:** keep monospace formatting for technical fields like `did:web:...`, `cart_hash:`, `approval_status:`. Mixes well with sans-serif for the prose captions.
- **Pacing safety net:** if total cut runs over 4:00 after voice + tight edits, the cheapest seconds to drop are scene 2's last beat (the "one orderForm" caption — content is covered later) and scene 6's silent hold.

## After recording — case study writeup

The video is the hook; the case study is the conversion. Pair the recorded video with a 1500–2000 word writeup at `case-study.md` that:

1. Explains why AP2 matters more for declines than approvals (the always-emit invariant — the strongest single beat from scene 5)
2. Walks through the three-party trust chain with the published DID URLs as live links
3. Documents what's mocked vs production (links to ADR-0003 + AP2_COMPLIANCE.md)
4. Shows the per-merchant config layer (links to ARCHITECTURE.md)
5. Lists the security model (links to issue 0010 closure + the 11-13h hardening cycle commits)
6. Closes with a "build this for your VTEX store" CTA

The video gets the viewer hooked in 4 minutes. The case study is what they read when they want to evaluate adopting it.

## Voice delivery tips

- **Tempo:** slower than you think. Conversational pace, not announcer pace. Resist the urge to fill every silence.
- **Emphasis:** lean on the contrast in scene 5 — *"Payment rejected. But the receipt itself is cryptographically valid."* The word "but" earns a beat of micro-pause.
- **Numbers and DIDs:** read DID URLs once; don't repeat them in every sentence. The captions carry the literal text.
- **Tone:** matter-of-fact, not hype. "Every signature is real" lands harder when said plainly than "amazing real signatures!"
- **Re-takes:** scenes 3 and 5 are the hardest to nail in one read. Plan 3+ takes for each. The other scenes are short enough that one or two takes typically work.
