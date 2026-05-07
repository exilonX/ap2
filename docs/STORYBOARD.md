# Demo Storyboard — Agent Commerce Gateway (AP2 case study)

**Target length:** 3:30–4:00. Hard cap 4:00.
**Format:** captions-first (mute-safe). Voice narration optional second pass.
**Primary surface:** Claude Desktop (most iconic for the AP2 / agentic-commerce story; cleanest to record).
**Secondary surface:** storefront chat widget (5s B-roll near the close to show "same backend, two surfaces").

## Production decisions (locked 2026-05-08)

- **Captions:** English only. The user-typed messages (Romanian: *"vreau o camasa"*, *"checkout"*) stay in Romanian for authenticity, with inline English caption translations. Caption track itself is English.
- **Camera:** screen-only, no face cam. Focus stays on the artifacts.
- **Workspace:** `acg / miniprix` (the current working setup) — already wired end-to-end with RON pricing, Romanian catalog, real products. Don't burn time spinning up an English-language workspace; the Romanian flavor reads as authentic, not a barrier.

---

## Pre-flight checklist

Before you hit record, verify each of these:

- [ ] Adapter linked to fresh workspace (`vtex link` from `packages/vtex-io-adapter`)
- [ ] App settings populated in VTEX Admin: `acgAllowedOrigins`, `acgAuthToken`, LLM keys, Pinecone keys
- [ ] Claude Desktop config has `ACG_AUTH_TOKEN` matching the adapter setting; restarted Claude Desktop after the change
- [ ] MCP server built (`npm run build` in `packages/mcp-server`) — `dist/apps/checkout.html` is the post-Step-6 26 KB version, NOT the April-1 11 KB one
- [ ] All three `.well-known/did.json` URLs return JSON in your browser:
  - `https://acg--miniprix.myvtex.com/_v/acg/.well-known/did.json`
  - `https://acg--miniprix.myvtex.com/_v/acg/mock-cp/.well-known/did.json`
  - `https://acg--miniprix.myvtex.com/_v/acg/mock-network/.well-known/did.json`
- [ ] Storefront has shipping address + customer profile pre-set on the demo cart (so 0014.a doesn't trigger awkward prompts mid-recording)
- [ ] Browser tabs ready in a separate window: a JSON-pretty-printed view of the merchant DID document
- [ ] Screen resolution locked to 1920×1080 or 16:9 equivalent (1280×720 also fine for smaller files)
- [ ] Hide the dock / taskbar / notifications. Do Not Disturb on.
- [ ] Run a happy-path dry run end-to-end before the real take. Force-reject too. If anything 403s or hangs, fix before rolling.

## Equipment notes

- **Recording tool:** OBS or built-in screen recorder. 1080p, 30fps minimum. Mouse cursor visible.
- **Editing tool:** DaVinci Resolve (free) or CapCut. Both handle caption tracks cleanly.
- **Caption font:** sans-serif, ~32–36px at 1080p, white text with a thin black outline OR semi-transparent black background. Caption stays for the FULL duration of the action it describes — viewers need time to read.
- **Caption position:** lower third, ~80px above the bottom edge. Don't cover the iframe content.
- **Pacing:** never let a scene run silent for more than 4s without a caption transition or visual change. Mute viewers tune out fast.

---

## Scene-by-scene

### Scene 1 — Cold open (0:00 → 0:15)

| | |
|---|---|
| **On screen** | Black background fading to a still of the merchant DID document JSON in a browser, key fields highlighted (`id`, `publicKeyHex`). Then crossfade to the Claude Desktop window with cursor in the chat input. |
| **Caption (sequential)** | (0:02) **Agent commerce on VTEX.**<br>(0:06) **Every signature is real EdDSA.**<br>(0:10) **Every artifact is publicly verifiable.** |
| **Voice (optional)** | "An AI agent shopping on a real VTEX store. What makes this different from every other 'AI shopping demo': every signature is real Ed25519, every artifact is published, anyone can verify the chain themselves." |
| **Capture** | Screen recording of browser → Claude Desktop. ~15s total. |

---

### Scene 2 — Live agent shopping (0:15 → 1:00)

| | |
|---|---|
| **On screen** | Claude Desktop window. Type the user message, watch tool calls fire, watch the iframe render. |
| **User types** (in Romanian, since that's the merchant's language) | *"vreau o camasa si niste pantaloni pentru barbati"* |
| **Tool calls visible** | `browseProducts` (×2 — one for camasa, one for pantaloni). Iframes render 3 products each with real images. |
| **Caption (sequential)** | (0:18) **MCP tool call: `browseProducts`**<br>(0:25) **→ VTEX IO adapter → live catalog**<br>(0:35) **Real merchant. Real products. RON pricing.** |
| **Action** | Click "Add to cart" on one shirt + one pair of pants from the product cards. |
| **Caption (during add)** | (0:45) **Cart preview rendered server-side from VTEX OrderForm.** |
| **Voice (optional)** | "I ask the agent for a shirt and some pants. The MCP server proxies the request to a VTEX IO adapter that hits the real catalog. The agent reads the results, builds a card UI, and adds two items to a real shopping cart." |
| **Capture** | Full Claude Desktop window. Make sure the tool-call expansion is visible at least once so viewers see the MCP plumbing. |

---

### Scene 3 — Checkout + signing ceremony (1:00 → 2:15)

| | |
|---|---|
| **User types** | *"checkout"* |
| **On screen** | The checkout iframe opens. AP2 Security panel shows: mandate-id, did:web:acg--miniprix.myvtex.com, cart hash, signed-at timestamp. Pay Now button is enabled. |
| **Caption (during iframe render)** | (1:05) **Merchant signs CartMandate (Ed25519, JCS-canonicalized).**<br>(1:10) **`did:web:acg--miniprix.myvtex.com` · cart_hash: 78e4a8f01f0ad…** |
| **Action** | Click **Pay Now**. The 4-step ceremony plays. |
| **Capture each step's reveal:** | |
| **Step 1 (caption)** | (1:20) **1. Re-verify CartMandate hasn't drifted from the live cart.** |
| **Step 2 (caption)** | (1:28) **2. Credentials Provider signs PaymentMandate.**<br>**transaction_data = [hash(CartMandate), hash(PaymentMandateContents)]** |
| **Step 3 (caption — appears as the 7 checks reveal)** | (1:40) **3. Network independently verifies the chain.**<br>(1:42) **7 checks: merchant sig · CP sig · hash binding · amount · mandate id · two expiries** |
| **Step 4 (caption)** | (1:58) **4. Order placed. Network signs the PaymentReceipt.** |
| **Final panel caption** | (2:08) **All three parties cryptographically attested. Three artifact links below.** |
| **Voice (optional)** | "When I say 'checkout,' the merchant signs a CartMandate — a verifiable digital credential committing to this exact cart. I click Pay Now. The Credentials Provider signs the PaymentMandate, binding the cart hash to the payment hash. The Network independently verifies seven separate properties — signatures, expiries, amount consistency. Each step is a real signed artifact. None of this is theatre." |
| **Capture note** | Make sure each step's reveal animation completes before moving on. The 80ms-staggered reveal of the 7 checks in step 3 is the most visually rich moment in the whole demo — let it land. |

---

### Scene 4 — Independent verification (2:15 → 2:50)

This is the strongest single beat for AP2 spec compliance. The viewer sees that the ceremony isn't a render — it produces real artifacts that anyone can verify against the published DIDs.

| | |
|---|---|
| **Action** | Click each of the three artifact links in turn. Each opens a new browser tab with the JSON. |
| **Tab 1 (CartMandate)** | Browser shows JSON. Highlight `verification.valid: true`, `merchant_authorization` JWT, `signedBy: did:web:acg--miniprix.myvtex.com`. |
| **Caption (Tab 1)** | (2:18) **CartMandate · verification.valid: true · signed by `did:web:acg--miniprix.myvtex.com`** |
| **Tab 2 (PaymentMandate)** | Highlight `payment_mandate_contents`, the W3C `payment_response`, the `user_authorization` JWT, `cpDID: did:web:acg--miniprix.myvtex.com:mock-cp`. |
| **Caption (Tab 2)** | (2:25) **PaymentMandate · `user_authorization` signed by `did:web:…:mock-cp`** |
| **Tab 3 (PaymentReceipt)** | Highlight `approval_status: approved`, all 7 `verification_checks: true`, `network_authorization` JWT, `networkDID: did:web:acg--miniprix.myvtex.com:mock-network`. |
| **Caption (Tab 3)** | (2:33) **PaymentReceipt · all 7 verification_checks true · signed by `did:web:…:mock-network`** |
| **Action (closer)** | Open all three `.well-known/did.json` URLs side-by-side (split-screen or rapid sequential). Highlight that each has a different `publicKeyHex`. |
| **Caption (closer)** | (2:42) **Three cryptographic identities. Three published keys. Anyone can verify the chain.** |
| **Voice (optional)** | "Click the artifact links. Each opens the signed JSON. The CartMandate verifies against the merchant's public key. The PaymentMandate against the Credentials Provider's. The PaymentReceipt against the Network's. Three different parties, three different DIDs, three different keypairs — all published, all reachable, all yours to verify." |

---

### Scene 5 — The rejection branch (2:50 → 3:25)

The always-emit invariant. The single most underappreciated property of AP2 in production.

| | |
|---|---|
| **On screen** | Reset to Claude Desktop. New cart, hit `checkout` again, iframe opens. |
| **Action** | Instead of Pay Now, click the small grey link **`(force reject — staging only)`** below it. |
| **Caption (immediately)** | (2:55) **Force-reject mode (staging only). The network will fail one check.** |
| **Action** | Watch the ceremony play: steps 1+2 succeed normally, step 3 reveals 6 ✓ + 1 ✗ on `payment_mandate_not_expired`, step 4 marks failed. |
| **Caption (during step 3 reveal)** | (3:05) **6 ✓ + 1 ✗. The network rejected the chain.** |
| **Final panel** | Reads: "Payment rejected · Reason: payment mandate has expired" — and contains the **PaymentReceipt** artifact link. |
| **Action** | Click the PaymentReceipt link. Browser opens the JSON. |
| **Highlight in JSON** | `approval_status: "rejected"` AND `verification.valid: true` (top-level). |
| **Caption (THE punchline)** | (3:15) **Payment rejected — but the receipt is cryptographically valid.**<br>(3:20) **The network *signed the rejection*. This is the always-emit invariant.** |
| **Voice (optional)** | "Now what happens when something goes wrong? In production this could be insufficient funds, a 3DS step-up failure, a fraud flag — anything. I trigger a rejection. The ceremony plays through, the network finds one check failed, and emits a signed rejection receipt. Watch this: open the receipt. The receipt itself is cryptographically valid. The network signed the rejection. Today, a decline is a string from the acquirer's logs. Tomorrow, it's a signed artifact from the issuer that the merchant, the cardholder, and any auditor can independently verify." |
| **Capture note** | This is the scene that earns the case study its tweet. Make sure the JSON view of the rejection receipt is fully visible — the contradiction between `approval_status: rejected` and `verification.valid: true` is the entire story. |

---

### Scene 6 — Architecture + secondary surface (3:25 → 3:50)

| | |
|---|---|
| **On screen** | Clean diagram (use Excalidraw or hand-draw in tldraw). Three boxes: Merchant Endpoint / Credentials Provider / Payment Network, each with their DID URL. Arrows showing CartMandate signed → PaymentMandate signed → PaymentReceipt emitted. |
| **Caption (over diagram)** | (3:27) **Mock CP and Network here = production swap-in for Google Pay, Visa, Mastercard.**<br>(3:33) **Same orchestration code. Replace the class, keep the chain.** |
| **Cut to (5–7 seconds)** | The storefront chat widget showing the same backend in a different UI surface. User typing a quick "*find me a black shirt*" → cards render inline. |
| **Caption (over widget)** | (3:42) **Same backend. Two surfaces: Claude Desktop, storefront widget. Future: ChatGPT, UCP.** |
| **Voice (optional)** | "The mock Credentials Provider and Network here are production swap-ins. Replace the class with Google Pay, replace the other with Visa. Orchestration code doesn't change. And this is the Claude Desktop surface — the same backend drives a chat widget on the storefront, and tomorrow a ChatGPT or UCP integration." |

---

### Scene 7 — Compliance + close (3:50 → 4:00)

| | |
|---|---|
| **On screen** | Plain text on dark background. |
| **Caption (sequential)** | (3:52) **AP2 v0.2 spec faithful · EdDSA Ed25519 · JCS canonicalization · DID:web identities**<br>(3:55) **Documented deviations: ISSUES.md 0017–0020 (W3C-wrap CartMandate, sd-jwt-vc, IntentMandate, 3DS2)**<br>(3:58) **Open source · github.com/exilonX/ap2** |
| **Voice (optional)** | "Spec-faithful where it lands the demo, with documented deviations on the path to v1. Open source. Build agent commerce that's auditable by design." |
| **Final frame** | Static, hold for 1.5s before fade out. URL prominent. |

---

## Editing notes

- **Cut every dead second.** If Claude is thinking for 2.3s before a tool call appears, jump-cut to the result. The 2-3s of thinking time across multiple tool calls is where viewers drop off.
- **Speed up scrolling** in the JSON-view scenes (scene 4, scene 5) to 1.5x. The viewer doesn't need to read every byte; they need to see the key fields highlighted.
- **Highlight key fields** in the JSON with a colored rectangle overlay or zoom-in. Don't expect viewers to spot `verification.valid: true` in a 200-line JSON dump.
- **The 80ms-staggered 7-check reveal** in scene 3 is the visual centerpiece. Don't speed it up. If anything, slow it slightly (1.2× the natural duration via re-recording with fewer concurrent reveals, or in post via a 0.85x speed clip).
- **Music:** optional. If using, choose something instrumental, low-energy, no lyrics. Cut entirely for scene 5's punchline so the on-screen contradiction lands in silence.

## After recording — case study writeup

The video is the hook; the case study is the conversion. Pair the recorded video with a 1500–2000 word writeup at `case-study.md` that:

1. Explains why AP2 matters more for declines than approvals (the always-emit invariant)
2. Walks through the three-party trust chain with the published DID URLs as live links
3. Documents what's mocked vs production (links to ADR-0003 + AP2_COMPLIANCE.md)
4. Shows the per-merchant config layer (links to ARCHITECTURE.md)
5. Lists the security model (links to issue 0010 closure + the 11-13h hardening cycle commits)
6. Closes with a "build this for your VTEX store" CTA

The video gets the viewer hooked in 4 minutes. The case study is what they read when they want to evaluate adopting it.

## Open questions before you record

- **Language for captions:** English only, or English + Romanian? English-only reaches a wider audience; Romanian feels more authentic given the merchant. Recommend English captions, leave the Romanian user-typed messages as authentic flavor.
- **Persona:** are you in front of the camera at any point, or screen-recording-only? Recommend screen-only — keeps focus on the artifacts, no lighting/recording-environment concerns.
- **Voice version timing:** record voice after the captioned cut is locked. Match voice to existing caption timings; don't re-edit the video around new voice pacing.
