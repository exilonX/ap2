# Demo Storyboard — Agent Commerce Gateway (AP2 case study)

**Target length:** 3:55–4:00. Hard cap 4:00.
**Format:** voice + captions paired. Voice carries narrative; captions reinforce technical detail.
**Primary surface:** Claude Desktop. **Secondary:** storefront chat widget (brief, in scene 6).

## Production decisions (locked 2026-05-08)

- **Voice + captions:** paired from take 1. Voice is the spine; captions are the technical reinforcement (DID URLs, hash prefixes, JSON field names).
- **User-typed Romanian** stays Romanian; voice narrates in English ("I ask the agent in Romanian for a shirt…").
- **Camera:** screen-only, no face cam.
- **Workspace:** `acg / miniprix`.
- **Repo strategy:** private. Case study lives on your portfolio; viewer books a call. **Code is not public.**
- **CTA:** commercial — "book a call to deploy on your store."

## Recording workflow

Screen-first silent → cut to script timing → voice-over → captions.

1. Capture screen silently following the scene actions.
2. Import to DaVinci Resolve / CapCut, cut every dead second.
3. Read voice script aloud while watching playback. 3+ takes per dense scene (3 and 5).
4. Overlay captions at the timestamps below.
5. Mix voice front (–12 dB), instrumental music if used at –18 dB; cut music entirely under scene 5's punchline.

Word budgets (~2.5 wps after natural pauses):

| Scene | Duration | Word budget |
|---|---|---|
| 1 — Montage cold open + AP2 primer (incl. H-P / H-N-P pillar) | 40s | ~85 words (montage is silent) |
| 2 — Live shopping | 30s | ~65 words |
| 3 — Three-actor signing ceremony | 70s | ~125 words |
| 4 — Independent verification (substantive) | 25s | ~65 words |
| 5 — Rejection branch (punchline) | 30s | ~60 words |
| 6 — Architecture diagram + RAG + widget | 30s | ~60 words |
| 7 — Compliance + commercial CTA | 15s | ~30 words |
| **Total** | **240s = 4:00** | **~490 words** |

---

## Pre-flight checklist

- [ ] Adapter linked (`vtex link` from `packages/vtex-io-adapter`)
- [ ] App settings populated: `acgAllowedOrigins`, `acgAuthToken`, LLM keys, Pinecone keys
- [ ] Claude Desktop config has `ACG_AUTH_TOKEN`; fully quit + reopen
- [ ] MCP server built; `dist/apps/checkout.html` is the latest version
- [ ] All three `.well-known/did.json` URLs resolve in browser
- [ ] Storefront has shipping address + customer profile pre-set
- [ ] Browser tabs ready: three DID document URLs pre-loaded, JSON-prettified
- [ ] **Architecture diagram image prepared** (see Scene 6 — Excalidraw / tldraw / Figma export)
- [ ] Screen resolution 1920×1080. Notifications off. Do Not Disturb on.
- [ ] Run happy-path + force-reject dry run end-to-end before rolling.

## Equipment notes

- 1080p / 30fps screen capture (OBS or native).
- USB mic in a quiet room (built-in laptop mic reads "amateur").
- DaVinci Resolve or CapCut for voice + caption tracks.
- Caption font: sans-serif 32–36px, white with thin black outline. Lower third, ~80px above bottom edge. Hold ~2s after voice line ends, then fade.
- Use **monospace** for caption fragments like `did:web:...`, `verification.valid: true`, `cart_hash:` — visually flags "this is a real technical field."

---

## Scene-by-scene

Each beat below uses this format:

> **(timestamp)** — *action description*
> **VOICE:** "exact words to read aloud"
> **CAPTION:** what appears on screen

---

### Scene 1 — Trailer-cut cold open + AP2 primer (0:00 → 0:40)

The viewer needs **a hook in the first 5 seconds**, not a static DID document. The pattern that works for dev-tool demos (Linear, Vercel, Cursor, Lovable, etc.): a 6–8 second fast-cut montage showcasing what was built, then drop into the explanation. Below is the rewrite — montage opener (8s), then the AP2 primer condensed to 32s.

**Visual:** Rapid-cut montage assembled from clips you'll record across the rest of the scenes, intercut at 1–1.5s per clip with crossfades. Total runtime ~8s. Then crossfade into the AP2 primer.

> **(0:00-0:08)** — *MONTAGE. Fast-cut, no voice, single sound effect or a low instrumental swell.*
>
> Clip sequence (1.0–1.5s each):
> 1. Chat in Romanian → tool call `browseProducts` expanding → product cards rendering
> 2. The 4-step ceremony mid-reveal — step 3's 7-check checklist animating in
> 3. PaymentReceipt JSON open in a browser tab, `verification.valid: true` highlighted
> 4. Three `.well-known/did.json` URLs side-by-side
> 5. Mandate badge in the storefront widget — *"Cryptographically signed by acg--miniprix.myvtex.com"*
> 6. Rejection receipt JSON — `approval_status: rejected` next to `verification.valid: true`
>
> **CAPTION (single, holds for the montage):** **Agent commerce. Cryptographically verifiable. Built in 4 weeks.**

> **(0:08-0:16)** — *Crossfade from montage to bold text: "Who's responsible when an AI buys?"*
> **VOICE:** "AI agents are shopping on our behalf — sometimes with the user actively chatting, sometimes autonomously while we sleep. Who's responsible when something goes wrong?"
> **CAPTION:** **Who's responsible when an AI buys?**

> **(0:16-0:24)** — *Split-screen: left = phone chat with agent labeled "Human present"; right = autonomous agent dashboard labeled "Human not present — buy when price drops".*
> **VOICE:** "AP2 — Google's Agent Payments Protocol — covers both modes. Human-present: you confirm in real time. Human-not-present: you pre-delegate authority and the agent acts later."
> **CAPTION:** **AP2 · Agent Payments Protocol · Google · v0.2**

> **(0:24-0:32)** — *Three-box animation: Merchant signs CartMandate · CP signs PaymentMandate · Network signs PaymentReceipt. Each box gets a key icon and a did:web URL.*
> **VOICE:** "Three actors. Three private keys. The merchant signs the cart, the Credentials Provider signs the payment, the Network signs the receipt — each with their own Ed25519 key."
> **CAPTION:** **3 actors · 3 private keys · 3 published DIDs**

> **(0:32-0:40)** — *Quick cut: Claude Desktop window opens. Settings → Developer panel briefly visible (~1.5s) showing `vtex-store · running`. Crossfade to the chat input ready for the demo.*
> **VOICE:** "Today's demo: human-present. The agent runs as an MCP server inside Claude Desktop, proxying to a VTEX IO backend."
> **CAPTION:** **MCP server: `vtex-store` · live connection**

---

### Scene 2 — Live shopping + RAG (0:40 → 1:10)

**Visual:** Claude Desktop window. Type, tool calls fire, iframe renders products, add to cart.

> **(0:40-0:55)** — *Type "vreau o camasa si niste pantaloni pentru barbati". Tool calls fire — make sure `vtex-store: browseProducts` is visible in the chat. Caption flags Pinecone since the UI doesn't visibly show it.*
> **VOICE:** "I ask the agent in Romanian for a shirt and some pants. The MCP tool call hits a VTEX IO adapter that queries both the live catalog and a Pinecone vector index. 'Pantaloni lungi închiși la culoare' returns actual long dark pants — semantic search, not keyword matches."
> **CAPTION:** **MCP → VTEX IO adapter · live catalog + Pinecone vector search**

> **(0:55-1:10)** — *Product cards render in iframes. Click add-to-cart on a shirt + pants.*
> **VOICE:** "The agent reads the results, renders product cards, adds two items to a real cart on the same orderForm a human would use."
> **CAPTION:** **Real merchant · Real prices · Real RON**

---

### Scene 3 — Three-actor signing ceremony (1:10 → 2:20)

**Visual:** Type "checkout"; iframe opens with AP2 Security panel; Pay Now button; click triggers 4-step animated ceremony.

This is where each actor is *named*, *roled*, and *attributed* to a real-world payment-industry equivalent. Voice script reflects that.

> **(1:10-1:18)** — *Type "checkout"; iframe opens; AP2 Security panel visible.*
> **VOICE:** "I type checkout. Three actors enter."
> **CAPTION:** **Three actors · three signatures · three roles**

> **(1:18-1:30)** — *Camera lingers on the AP2 Security panel showing merchant DID, mandate ID, cart hash.*
> **VOICE:** "First — the Merchant. The VTEX store itself, identified by `did:web` pointing at `miniprix.myvtex.com`. The merchant signs the CartMandate: 'I commit to selling exactly these items at this price.'"
> **CAPTION:** **Merchant signs CartMandate · `did:web:acg--miniprix.myvtex.com`**

> **(1:30-1:35)** — *Click Pay Now button. Ceremony step 1 reveals — green check next to "Re-verify CartMandate against current cart."*
> **VOICE:** "Pay Now. Step one — re-hash the live cart and compare to the signed mandate. Drift detection catches cart-tamper between sign and pay."
> **CAPTION:** **Step 1 · re-hash live cart · drift detection (catches cart-tamper post-sign)**

> **(1:35-1:55)** — *Step 2 reveals. Caption emphasizes the CP's real-world equivalents AND the human-presence flag on the PaymentMandate.*
> **VOICE:** "Second — the Credentials Provider. In production this is Stripe, Adyen, PayPal, or Google Pay — the party holding the user's card-on-file. Here, a mock CP. The CP signs the PaymentMandate, binding the cart hash to the payment hash. Neither can be tampered without invalidating both."
> **CAPTION (primary):** **CP signs PaymentMandate · prod: Stripe / Adyen / PayPal / Google Pay**
> **CAPTION (secondary, smaller, 2s overlay at 1:50):** **`agent_presence: { human_present: true }` · H-N-P mode uses IntentMandate**

> **(1:55-2:12)** — *Step 3 reveals; the 7-check checklist animates in. Don't speed up.*
> **VOICE:** "Third — the Payment Network. Visa or Mastercard in production. Here, a mock. The Network independently verifies seven separate properties — signatures, hash binding, amount, mandate IDs, expiries — then signs the PaymentReceipt."
> **CAPTION:** **Network verifies 7 properties · prod: Visa / Mastercard · signs PaymentReceipt**

> **(2:12-2:20)** — *Final "Payment authorized" panel; three artifact links visible.*
> **VOICE:** "Three parties. Three roles. None can lie without the others noticing."
> **CAPTION:** **None can lie without the others noticing.**

---

### Scene 4 — Independent verification (2:20 → 2:45)

The strongest single beat for AP2 credibility. The viewer needs to feel that **three different parties hold three different private keys**, none of which can sign on each other's behalf, and that anyone with a browser can verify the chain.

**Visual:** Click each artifact link; new browser tabs with JSON; key fields highlighted; close on the three DID documents side-by-side.

> **(2:20-2:27)** — *Click CartMandate link. Browser opens JSON. Highlight `merchant_authorization` (the JWT string), `verification.valid: true`, `signedBy: did:web:acg--miniprix.myvtex.com`.*
> **VOICE:** "The CartMandate. This JWT was signed by the merchant's private Ed25519 key. Their public key sits at a published `.well-known` URL — anyone can fetch it and verify this signature."
> **CAPTION:** **CartMandate · signed with merchant's private key · public key at `/.well-known/did.json`**

> **(2:27-2:33)** — *Click PaymentMandate link. Browser opens. Highlight `user_authorization` JWT, the `cp_did` field, `payment_response.details.token`.*
> **VOICE:** "The PaymentMandate. Signed by the Credentials Provider with their own private key — different party, different key. In production: Stripe, Adyen, PayPal, or Google Pay."
> **CAPTION:** **PaymentMandate · CP's private key · prod: Stripe / Adyen / PayPal / Google Pay**

> **(2:33-2:39)** — *Click PaymentReceipt link. Browser opens. Highlight `approval_status: "approved"`, all 7 `verification_checks: true`, `network_authorization` JWT, `network_did`.*
> **VOICE:** "The PaymentReceipt. Signed by the Network with theirs — third party, third key. In production: Visa or Mastercard."
> **CAPTION:** **PaymentReceipt · Network's private key · prod: Visa / Mastercard · 7/7 checks ✓**

> **(2:39-2:45)** — *Split-screen the three `.well-known/did.json` URLs. Highlight that each shows a different `publicKeyHex` value — visibly different hex strings.*
> **VOICE:** "Three private keys, held by three different parties. Three public keys, published at three different URLs. Verification needs no SDK and no trust — just the URLs."
> **CAPTION:** **3 private keys · 3 published public keys · 3 different parties · zero shared trust**

---

### Scene 5 — Rejection branch / always-emit invariant (2:45 → 3:15)

The single strongest beat. Tighten language; let the contradiction (rejected + valid) land in near-silence.

**Visual:** New cart → "checkout" → iframe → click force-reject link → ceremony with 6 ✓ + 1 ✗ → open rejection receipt JSON.

> **(2:45-2:50)** — *New cart, "checkout" typed, iframe re-opens.*
> **VOICE:** "What happens when something goes wrong?"
> **CAPTION:** **What if a check fails?**

> **(2:50-2:58)** — *Click "(force reject — staging only)" link.*
> **VOICE:** "In production: insufficient funds, fraud flag, 3DS step-up failure. Here I force the Network to fail one check."
> **CAPTION:** **Force-reject (staging only) · fails `payment_mandate_not_expired`**

> **(2:58-3:05)** — *Ceremony plays through; step 3 reveals 6 ✓ + 1 ✗.*
> **VOICE:** "Steps one and two succeed. Step three: six green, one red. The Network rejected."
> **CAPTION:** **6 ✓ + 1 ✗ · Network rejected**

> **(3:05-3:15)** — *Click PaymentReceipt link; JSON opens with `approval_status: "rejected"` AND `verification.valid: true` both visible. Music drops to silence here.*
> **VOICE:** "The receipt. Payment rejected — *but the receipt itself is cryptographically valid*. The Network signed the rejection. Today a decline is a string from the acquirer's logs. Tomorrow, it's evidence anyone can verify."
> **CAPTION:** **`approval_status: rejected` · `verification.valid: true` · always-emit invariant**

---

### Scene 6 — Architecture + RAG + widget (3:15 → 3:45)

You asked for an actual architecture diagram. Below is the diagram spec — create the image in Excalidraw or tldraw before recording.

**Visual:** Architecture diagram (~20s), then 5s cut to widget B-roll.

**Diagram spec** (compose this before recording, export PNG/SVG at 1920×1080):

```
┌─────────────────┐
│      USER       │
│  (Claude Desktop│
│   or storefront │
│      widget)    │
└────────┬────────┘
         │ chat / actions
         ▼
┌─────────────────────────────────────────────┐
│           SHOPPING AGENT                    │
│   (MCP server  ·  Anthropic Claude)         │
└────────┬────────────────────────────────────┘
         │ HTTPS  (+ X-ACG-Auth-Token / Origin)
         ▼
┌─────────────────────────────────────────────┐
│      MERCHANT — VTEX IO Adapter             │
│  did:web:acg--miniprix.myvtex.com           │
│  • /_v/acg/* routes (rate-limited)          │
│  • VBase: keys, mandates, receipts          │
│  • signs CartMandate (Ed25519 / JCS)        │
└────┬───────────────┬───────────────┬────────┘
     │               │               │
     │  semantic     │  catalog      │  identity
     ▼               ▼               ▼
┌─────────┐  ┌─────────────┐  ┌──────────────┐
│Pinecone │  │ VTEX Search │  │  OpenAI      │
│ vectors │  │   + OMS     │  │  embeddings  │
└─────────┘  └─────────────┘  └──────────────┘

   ── At checkout, agent calls: ──

┌─────────────────────────────────────────────┐
│   CREDENTIALS PROVIDER                      │
│  did:web:…:mock-cp                          │
│  signs PaymentMandate                       │
│  prod swap-in: Stripe / Adyen / PayPal /    │
│                Google Pay                   │
└────┬────────────────────────────────────────┘
     ▼
┌─────────────────────────────────────────────┐
│   PAYMENT NETWORK                           │
│  did:web:…:mock-network                     │
│  verifies 7 properties · signs Receipt      │
│  prod swap-in: Visa / Mastercard            │
└─────────────────────────────────────────────┘
```

> **(3:15-3:25)** — *Architecture diagram on screen. Camera pans over the boxes from top to bottom.*
> **VOICE:** "Behind the scenes — a VTEX IO adapter serves all the routes. Pinecone holds vector embeddings of the catalog so semantic queries work. OpenAI handles embeddings, Anthropic runs the chat loop."
> **CAPTION:** **VTEX IO · Pinecone · OpenAI · Anthropic**

> **(3:25-3:35)** — *Diagram pans to the three identity boxes. Highlight the three DIDs.*
> **VOICE:** "Three cryptographic identities — merchant, mock CP, mock Network — each with its own `did:web`. In production, swap the mocks for Stripe and Visa. Orchestration code doesn't change."
> **CAPTION:** **Three identities · production swap-in: Stripe + Visa**

> **(3:35-3:45)** — *Cut to storefront chat widget showing a product search rendering inline.*
> **VOICE:** "The same backend powers the storefront chat widget. Tomorrow, a ChatGPT or UCP surface — same engine."
> **CAPTION:** **One backend · Claude Desktop · storefront widget · ChatGPT next**

---

### Scene 7 — Compliance + commercial CTA (3:45 → 4:00)

**Visual:** Plain dark background with text + your portfolio URL prominent.

> **(3:45-3:53)** — *Text appears: AP2 v0.2 · spec details.*
> **VOICE:** "AP2 v0.2 spec-faithful for the human-present flow. IntentMandate next for human-not-present. Production CP swap-in ready."
> **CAPTION:** **AP2 v0.2 · human-present shipped · IntentMandate (H-N-P) next · prod CP swap-in ready**

> **(3:53-4:00)** — *Portfolio URL / contact CTA prominent. Hold final frame for 1.5s before fade.*
> **VOICE:** "Want this on your store? Book a call — link below."
> **CAPTION:** **Deploy AP2 agent commerce on your VTEX store · `[your-portfolio.com/ap2]`**

---

## Editing notes

- **Cut every dead second.** Voice script assumes tight cuts.
- **Speed up JSON scrolling** in scenes 4 and 5 to 1.5×.
- **Highlight key fields** in JSON with colored rectangles / zoom-ins.
- **7-check reveal in scene 3:** don't speed up; the 80ms stagger is the visual centerpiece. If anything, slow to 0.85× so the voice line fits naturally.
- **Music:** instrumental, –18 dB. **Cut entirely** under scene 5's punchline — the contradiction (rejected + valid) lands harder in silence.
- **Caption styling:** monospace for technical fields (`did:web:…`, `cart_hash:`, `verification.valid:`). Sans-serif for prose. Color contrast: white on dark works in both light and dark thumbnails.
- **Pacing safety net:** if cut runs >4:00, cheapest seconds to drop are scene 2's "One orderForm" beat and scene 6's widget B-roll cut.

## Architecture diagram — preparation

Before recording scene 6, create the diagram as a static image:

- **Tool:** Excalidraw, tldraw, or Figma. Hand-drawn lines OK if legible.
- **Export:** PNG or SVG at 1920×1080 (matches the recording resolution).
- **Layout:** vertical flow as shown in the spec above. User at top, three signing parties at bottom.
- **Highlight in color:** the three DID boxes (merchant / mock-cp / mock-network) — green tint or a colored border. These are the cryptographic boundaries the diagram is communicating.
- **Annotate the production swap-ins** in muted text next to each mock: "→ Stripe / Adyen / PayPal" next to mock-cp, "→ Visa / Mastercard" next to mock-network.
- **Don't crowd:** prefer fewer arrows + clearer boxes. The viewer has ~20s on this scene, can't read 50 labels.

## After recording — case study writeup (on your portfolio)

The video is the hook; the case study is the conversion path on your site. Pair the video with a writeup that:

1. Opens with **the always-emit invariant** (the punchline from scene 5) — the strongest single technical hook.
2. Walks through the three-actor model with the published DID URLs as live links (your site can show them resolving live).
3. Documents what's mocked vs production-ready (links to ADR-0003 + AP2_COMPLIANCE.md *inside your private repo* — or reproduce the relevant tables on the public page).
4. Shows the architecture diagram (same image as scene 6) with labels expanded.
5. Lists the security model (origin allowlist, rate limiting, session cost cap, per-orders auth — issue 0010 closure).
6. **Closes with a contact form** — "Book a call to evaluate deploying AP2 agent commerce on your VTEX store."

Code stays private. The case study, the video, and the contact form do the rest.

## Voice delivery tips

- **Tempo:** slower than feels natural. Conversational, not announcer.
- **Emphasis:** lean on the contrast in scene 5 — *"Payment rejected. **But** the receipt itself is cryptographically valid."* The "but" earns a micro-pause.
- **Actor names:** in scene 3, slow down on "Stripe, Adyen, PayPal, Google Pay" and "Visa, Mastercard" — those are the recognizable names that anchor the unfamiliar terminology to the viewer's existing mental model.
- **Numbers and DIDs:** read once; let captions carry literal text.
- **Tone:** matter-of-fact, not hype. "Every signature is real" lands harder said plainly than amplified.
- **Re-takes:** scenes 1, 3, 5 are the most dense. Plan 3+ takes each. Scenes 2, 4, 6, 7 typically work in 1–2 takes.
