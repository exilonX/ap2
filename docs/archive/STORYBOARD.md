# Demo Storyboard — Agent Commerce Gateway (AP2 case study)

> **Format:** every beat has a STAGE block (what to record / build) and one or more CAPTION cards (the on-screen text that carries the narrative). **Captions are load-bearing** — they replace voice. Voice is optional and can be added later (yours, or AI like ElevenLabs).

> **Every beat is tagged 🔴 REC or 🟦 POST.**
> 🔴 **REC** — live screen capture during the recording session.
> 🟦 **POST** — built in the editor (title cards, montage cuts, text overlays, animated graphics, all captions).

**Runtime:** 4:00. **No voice required for v1.** Caption-driven from take 1.

---

## Caption styling (read-once, then apply consistently)

- **Font:** sans-serif, white text. Body 38–44px @ 1080p, hint lines 22–26px.
- **Background:** dark semi-transparent bar (rgba(0,0,0,0.65)) bottom-third OR a dark band that auto-sizes to text.
- **Hold time:** each caption stays ≥ 3s. Long captions: ≥ 5s. Never flash a caption for less than the time a moderate reader needs to finish it (~4 words/second).
- **Card transitions:** soft fade in (~200ms), fade out (~300ms). No slide-ins, no flashy.
- **Technical fields** (`did:web:…`, `cart_hash:`, `verification.valid:`) — monospace, slightly smaller than body.
- **Strong contrast vs the action.** If the screen content is busy (JSON, animated ceremony), the caption bar gets stronger background opacity.

---

## Pre-flight checklist

- [ ] Adapter linked (`vtex link` from `packages/vtex-io-adapter`)
- [ ] App settings populated (`acgAllowedOrigins`, `acgAuthToken`, LLM keys, Pinecone keys)
- [ ] Claude Desktop config has `ACG_AUTH_TOKEN`; fully quit + reopen
- [ ] MCP server built; `dist/apps/checkout.html` is the latest version
- [ ] All three `.well-known/did.json` URLs resolve in browser
- [ ] Storefront has shipping address + customer profile pre-set
- [ ] Browser tabs ready: three DID URLs pre-loaded, JSON-prettified
- [ ] Portfolio case-study page open in a tab (for Scene 6 architecture diagram)
- [ ] Screen resolution 1920×1080. Notifications off. Do Not Disturb on.
- [ ] Run happy-path + force-reject dry run before rolling.

## Production decisions (locked)

- **Caption-driven** (no voice for v1). Add voice later if quality allows.
- **Caption language:** English. User-typed Romanian stays Romanian.
- **Camera:** screen-only, no face cam.
- **Workspace:** `acg / miniprix`.
- **Repo:** BSL public on GitHub. Case study on portfolio.
- **CTA:** commercial — "book a call to deploy."

## Recording workflow (captions-driven)

1. **Capture all 🔴 REC beats** silently with no narration.
2. **Build the 🟦 POST beats** in your editor (title slates, montage, two-mode card, three-actor card, compliance card, CTA card).
3. **Lay everything onto the timeline** at the timestamps below.
4. **Add captions** at the per-beat moments. Caption hold-times listed for each card.
5. **(Optional v2)** Record voice or generate AI voiceover from the OLD SAY blocks (preserved in commit history if you want to recover them).

---

# SCENE 1 — Intro + montage + AP2 primer  ·  0:00 → 0:44

---

### Beat 1.1  ·  0:00 – 0:04  ·  Title slate  ·  🟦 POST

**STAGE:** Black background. Large centered text fades in.

**CAPTION — full beat:**
> # Agent Commerce on AP2
>
> *An implementation of Google's Agent Payments Protocol*
>
> *Signed and verifiable. Built in 4 weeks.*

Title holds for the full 4 seconds.

---

### Beat 1.2  ·  0:04 – 0:12  ·  Rapid-cut montage (the hook)  ·  🟦 POST

**STAGE:** Six clips, 1.0 – 1.5 seconds each, crossfaded. **All clips are extracts from your 🔴 REC footage of Scenes 2–5.** Nothing new is captured.

| # | Clip source (REC footage) | What it shows |
|---|---|---|
| 1 | Scene 2 | Romanian chat → `browseProducts` tool call expanding → product cards rendering |
| 2 | Scene 3 | 4-step ceremony mid-reveal — 7-check checklist animating in |
| 3 | Scene 4 | PaymentReceipt JSON, `verification.valid: true` highlighted |
| 4 | Scene 4 closer | Three `.well-known/did.json` URLs side-by-side |
| 5 | Scene 2 / widget | Mandate badge — *"Cryptographically signed by acg--miniprix.myvtex.com"* |
| 6 | Scene 5 | Rejection receipt JSON — `approval_status: rejected` next to `verification.valid: true` |

**CAPTION — held for the full 8s, large centered:**
> ## Agent commerce. Cryptographically verifiable.

---

### Beat 1.3  ·  0:12 – 0:20  ·  The problem  ·  🟦 POST

**STAGE:** Dark background. Question text fades in large, centered. Below the question, smaller body text appears after a 2s delay.

**CAPTION (held 0:12–0:20):**
> ## Who's responsible when an AI buys?

**CAPTION (smaller, fades in at 0:15, held until 0:20):**
> *Merchant doesn't see the user. Bank doesn't see the agent. Today, no cryptographic proof anyone consented.*

---

### Beat 1.4  ·  0:20 – 0:28  ·  The two modes  ·  🟦 POST

**STAGE:** Two stylized boxes side-by-side fade in together.

**LEFT BOX (held 0:20–0:28):**
> ### Human present
> You chat with the agent in real time.
> Confirm each step.
> → **CartMandate**

**RIGHT BOX (held 0:20–0:28):**
> ### Human not present
> You pre-delegate authority.
> *"Buy these shoes when they drop below 80 RON."*
> → **IntentMandate**

**CAPTION (subtitle band at the bottom, 0:23–0:28):**
> **AP2 — Google's Agent Payments Protocol — covers both modes. Today: human-present.**

---

### Beat 1.5  ·  0:28 – 0:36  ·  Three actors, three keys  ·  🟦 POST

**STAGE:** Three boxes appearing left-to-right (animate in at 0:28, 0:30, 0:32).

**BOX 1 (Merchant, appears 0:28):**
> 🔑 Merchant
> signs CartMandate
> `did:web:<store>`

**BOX 2 (CP, appears 0:30):**
> 🔑 Credentials Provider
> signs PaymentMandate
> `did:web:<cp>`
> *prod: Stripe / Adyen / PayPal / Apple Pay*

**BOX 3 (Network, appears 0:32):**
> 🔑 Payment Network
> signs PaymentReceipt
> `did:web:<network>`
> *prod: Visa / Mastercard*

**CAPTION (subtitle band, held 0:32–0:36):**
> **3 actors · 3 private Ed25519 keys · 3 public DIDs · independent verification**

---

### Beat 1.6  ·  0:36 – 0:44  ·  MCP plumbing reveal + tool surface  ·  🔴 REC

**STAGE:** Live screen capture. Two sub-shots, no dead air.

1. **(0:36–0:39, 3s):** In Claude Desktop, open Settings → Developer. **`vtex-store · running`** visible.
2. **(0:39–0:44, 5s):** Close Settings. Click the **"Search and tools"** icon in the chat input bar so the list of MCP tools opens — `browseProducts`, `addToCart`, `checkoutInChat`, `executePayment`, etc. Camera lingers on the list.

**CAPTION (held 0:36–0:40):**
> **MCP server: `vtex-store` · live connection**

**CAPTION (replaces previous, held 0:40–0:44):**
> **16 tools exposed: search · cart · checkout · AP2 payment**
> *That's the entire trust surface. Nothing more.*

---

# SCENE 2 — Live shopping + RAG  ·  0:44 → 1:14

---

### Beat 2.1  ·  0:44 – 0:59  ·  Type and search  ·  🔴 REC

**STAGE:** Live capture in Claude Desktop.
1. Type *vreau o camasa si niste pantaloni pentru barbati* into chat.
2. Hit enter. Wait for tool calls — `vtex-store: browseProducts` becomes visible and expands.
3. Let the tool-call expansion stay visible for ~3s.

**CAPTION (held 0:44–0:50):**
> **User asks (in Romanian): *"I want a shirt and some pants for men."***

**CAPTION (replaces, held 0:50–0:59):**
> **MCP tool call: `browseProducts`**
> *VTEX IO adapter → live catalog + Pinecone vector index → semantic match*

---

### Beat 2.2  ·  0:59 – 1:14  ·  Render and add to cart  ·  🔴 REC

**STAGE:** Continue live capture.
1. Product cards render in iframes. Wait for images to load.
2. Click *Add to cart* on one shirt, then one pair of pants.
3. Cart preview card appears with running total in RON.

**CAPTION (held 0:59–1:07):**
> **Real merchant. Real prices. Real RON.**

**CAPTION (replaces, held 1:07–1:14):**
> **Cart shared with native VTEX checkout — same `orderForm`, same cookie session.**

---

# SCENE 3 — Three-actor signing ceremony  ·  1:14 → 2:24

---

### Beat 3.1  ·  1:14 – 1:22  ·  Type "checkout"  ·  🔴 REC

**STAGE:** Live capture.
1. Type *checkout*. Hit enter.
2. Iframe opens with cart preview + AP2 Security panel showing mandate ID, merchant DID, cart hash.

**CAPTION (held 1:14–1:22):**
> ## Three actors enter the picture.

---

### Beat 3.2  ·  1:22 – 1:34  ·  Merchant signs CartMandate  ·  🔴 REC

**STAGE:** Camera lingers on the AP2 Security panel. **POST overlay:** colored rectangle highlighting the mandate ID and `did:web:acg--miniprix.myvtex.com`.

**CAPTION (held 1:22–1:28):**
> ### 1️⃣ Merchant signs CartMandate
> *The VTEX store commits to these items at this price.*

**CAPTION (replaces, held 1:28–1:34):**
> **Signed by:** `did:web:acg--miniprix.myvtex.com`
> *Private Ed25519 key · public counterpart at `/.well-known/did.json`*

---

### Beat 3.3  ·  1:34 – 1:39  ·  Click Pay Now + drift check  ·  🔴 REC

**STAGE:** Click **Pay Now**. Ceremony Step 1 reveals green check next to *"Re-verify CartMandate against current cart."*

**CAPTION (held 1:34–1:39):**
> **Step 1 · Re-hash live cart → compare to signed mandate**
> *Drift detection catches cart-tamper between sign and pay.*

---

### Beat 3.4  ·  1:39 – 1:58  ·  CP signs PaymentMandate  ·  🔴 REC

**STAGE:** Ceremony Step 2 reveals green check.

**CAPTION (held 1:39–1:47):**
> ### 2️⃣ Credentials Provider signs PaymentMandate
> *The party holding the user's card. Confirms user authorized this payment.*

**CAPTION (replaces, held 1:47–1:53):**
> **Production CP:** Stripe · Adyen · PayPal · Apple Pay · Google Pay
> **Demo CP:** mock — same shape, real Ed25519

**CAPTION (replaces, held 1:53–1:58):**
> `agent_presence: { human_present: true }`
> *H-N-P mode would use IntentMandate (post-demo)*

---

### Beat 3.5  ·  1:58 – 2:15  ·  Network verifies, signs Receipt  ·  🔴 REC

**STAGE:** Ceremony Step 3 reveals. **7-check checklist animates in at 80ms intervals — do not speed up.** Step 4 reveals with order placed.

**CAPTION (held 1:58–2:05):**
> ### 3️⃣ Payment Network verifies the chain
> *Independent third party. Doesn't know the user — only the cryptography.*

**CAPTION (replaces, held 2:05–2:11):**
> **7 checks:** signatures · hash binding · amount · mandate IDs · expiries
> *All must pass.*

**CAPTION (replaces, held 2:11–2:15):**
> **Production Network:** Visa · Mastercard
> **Demo Network:** mock — signs PaymentReceipt

---

### Beat 3.6  ·  2:15 – 2:24  ·  Final panel — three artifact links  ·  🔴 REC

**STAGE:** *Payment authorized · Order ACG-XXXX* panel visible. Three artifact buttons: CartMandate · PaymentMandate · PaymentReceipt.

**CAPTION (held 2:15–2:24):**
> ## Three parties. Three roles.
> ### None can lie without the others noticing.

---

# SCENE 4 — Independent verification  ·  2:24 → 2:49

The strongest single beat for AP2 credibility. The viewer must feel that **three different parties hold three different private keys**, none of which can sign on each other's behalf.

---

### Beat 4.1  ·  2:24 – 2:31  ·  CartMandate JSON  ·  🔴 REC + 🟦 POST overlay

**STAGE:**
1. **REC:** click the CartMandate link. New browser tab opens with JSON.
2. **POST:** colored rectangle highlights around `merchant_authorization` (the JWT), `verification.valid: true`, `signedBy: did:web:acg--miniprix.myvtex.com`.

**CAPTION (held 2:24–2:31):**
> ### CartMandate
> **Signed by the merchant's private Ed25519 key.**
> *Public counterpart at `/.well-known/did.json` — fetch it, verify the JWT, done.*

---

### Beat 4.2  ·  2:31 – 2:37  ·  PaymentMandate JSON  ·  🔴 REC + 🟦 POST overlay

**STAGE:**
1. **REC:** click PaymentMandate link. New tab opens JSON.
2. **POST:** highlights on `user_authorization` JWT, `cp_did`, `payment_response.details.token`.

**CAPTION (held 2:31–2:37):**
> ### PaymentMandate
> **Signed by the CP's private key. Different party, different key.**
> *Prod: Stripe · Adyen · PayPal · Apple Pay*

---

### Beat 4.3  ·  2:37 – 2:43  ·  PaymentReceipt JSON  ·  🔴 REC + 🟦 POST overlay

**STAGE:**
1. **REC:** click PaymentReceipt link. New tab opens JSON.
2. **POST:** highlights on `approval_status: "approved"`, all 7 `verification_checks: true`, `network_authorization` JWT, `network_did`.

**CAPTION (held 2:37–2:43):**
> ### PaymentReceipt
> **Signed by the Network's private key. Third party, third key.**
> *Prod: Visa · Mastercard · all 7 checks ✓*

---

### Beat 4.4  ·  2:43 – 2:49  ·  Three DID documents side-by-side  ·  🔴 REC + 🟦 POST overlay

**STAGE:**
1. **REC:** the three `.well-known/did.json` URLs open in three split-screen tabs (pre-arranged).
2. **POST:** colored boxes around each `publicKeyHex` value — three visibly different hex strings.

**CAPTION (held 2:43–2:49):**
> ## 3 private keys · 3 public keys · 3 different parties
> **Verification needs no SDK and no trust — just the URLs.**

---

# SCENE 5 — Rejection branch (the punchline)  ·  2:49 → 3:19

The single strongest beat. The contradiction (rejected + valid) must land hard.

---

### Beat 5.1  ·  2:49 – 2:54  ·  New cart, open checkout  ·  🔴 REC

**STAGE:** Live capture.
1. Reset to Claude Desktop. New cart.
2. Type *checkout*. Iframe re-opens.

**CAPTION (held 2:49–2:54):**
> ## What happens when something goes wrong?

---

### Beat 5.2  ·  2:54 – 3:02  ·  Click force-reject  ·  🔴 REC

**STAGE:** Click the small grey **`(force reject — staging only)`** link below the Pay Now button.

**CAPTION (held 2:54–3:02):**
> ### Force-reject (staging only)
> *Simulates: insufficient funds · fraud flag · 3DS step-up failure*
> **The Network will fail one check.**

---

### Beat 5.3  ·  3:02 – 3:09  ·  6 green + 1 red  ·  🔴 REC

**STAGE:** Ceremony plays. Steps 1 + 2 succeed. Step 3 reveals 6 green ✓ + 1 red ✗ on `payment_mandate_not_expired`. Step 4 marks failed.

**CAPTION (held 3:02–3:09):**
> **6 ✓ + 1 ✗ · Network rejected the chain**

---

### Beat 5.4  ·  3:09 – 3:19  ·  The contradiction (THE PUNCHLINE)  ·  🔴 REC + 🟦 POST overlay

**STAGE:**
1. **REC:** click the PaymentReceipt link. JSON opens.
2. **POST:** strong colored highlight boxes around BOTH `approval_status: "rejected"` AND `verification.valid: true` at the top level — visible at the same time.

**CAPTION (held 3:09–3:14, large, centered):**
> ## Payment rejected.

**CAPTION (replaces, held 3:14–3:19, slightly smaller, with emphasis):**
> ## But the receipt itself is *cryptographically valid*.
> **The Network *signed the rejection*. Today a decline is a string. Tomorrow it's evidence.**

> **The always-emit invariant.** This is the AP2 punchline. Hold it.

---

# SCENE 6 — Architecture + RAG  ·  3:19 → 3:45

---

### Beat 6.1  ·  3:19 – 3:30  ·  Architecture diagram (from case study)  ·  🔴 REC

**STAGE:** Live capture.
1. Navigate to the case study page on your portfolio site.
2. Scroll to the three-party trust chain SVG.
3. Camera lingers on the three identity boxes. Pan to show Pinecone, OpenAI, Anthropic.

> **Reuse the existing SVG diagram. No new image asset needed.**

**CAPTION (held 3:19–3:25):**
> ### Stack
> **VTEX IO · Pinecone · OpenAI · Anthropic**

**CAPTION (replaces, held 3:25–3:30):**
> *Pinecone: vector embeddings of the catalog → semantic search*
> *OpenAI: embeddings · Anthropic: chat loop*

---

### Beat 6.2  ·  3:30 – 3:45  ·  Production swap-in  ·  🔴 REC

**STAGE:** Stay on the diagram. Pan to / highlight the three identity boxes (Merchant / mock CP / mock Network).

**CAPTION (held 3:30–3:38):**
> ### 3 identities → production swap-in is one class change
> **mock CP** → Stripe · Adyen · PayPal · Google Pay
> **mock Network** → Visa · Mastercard

**CAPTION (replaces, held 3:38–3:45):**
> **Backend-agnostic:** same engine runs on Shopify · BigCommerce · any headless setup.
> *Three small interfaces — `CartProvider`, `CatalogProvider`, `KeyStore` — bridge to any backend.*

---

# SCENE 7 — Compliance + commercial CTA  ·  3:45 → 4:00

---

### Beat 7.1  ·  3:45 – 3:53  ·  Compliance summary  ·  🟦 POST

**STAGE:** Plain dark background. Text appears.

**CAPTION (held 3:45–3:53):**
> ### AP2 v0.2 spec-faithful
> **EdDSA Ed25519 · JCS (RFC 8785) · `did:web`**
>
> ✅ Human-present shipped
> 🔜 IntentMandate (human-not-present) next
> ✅ Production CP swap-in ready

---

### Beat 7.2  ·  3:53 – 4:00  ·  CTA + portfolio URL  ·  🟦 POST

**STAGE:** Plain dark background. URLs prominent.

**CAPTION (held 3:53–4:00, large):**
> ## Want this on your store?
>
> **github.com/exilonX/ap2**
> **[your-portfolio.com/ap2-case-study]**
>
> *Source under BSL 1.1 · Book a call to deploy*

Hold the final frame for 1.5 seconds before fade-out.

---

## REC / POST counts (after captions-only rebuild)

| Type | Count | Beats |
|---|---|---|
| 🔴 **REC** (live screen capture) | 14 | Scene 1.6 · all of Scenes 2, 3, 4, 5, 6 |
| 🟦 **POST** (editor-built cards) | 7 | Scene 1.1–1.5 · Scene 7.1, 7.2 |
| 🔴 + 🟦 (REC base + POST overlay highlights) | 4 | Beats 4.1, 4.2, 4.3, 4.4, 5.4 |
| **Captions on every beat** | every beat | The narrative is fully caption-carried |

---

## Editing notes

- **Cut every dead second.** Caption-driven means viewers need pacing variety — too much hold-time on one card and they tune out.
- **Speed up JSON scrolling** in scenes 4 and 5 to 1.5×.
- **Highlight key fields** in JSON with colored rectangles or zoom-ins.
- **7-check reveal in Beat 3.5:** never speed up. Slow to 0.85× if captions need more breathing room.
- **Music:** instrumental, –18 dB. **Cut entirely under Beat 5.4** — the contradiction lands harder in silence.
- **Caption font sizing:** title-style captions (## headers in this doc) at 44–52px, body at 36–38px, technical fields slightly smaller (~28px monospace).
- **Caption hold times** listed per beat. Never less than ~3s. Long captions ≥ 5s.

---

## Optional: adding voice in v2

If you ever want voice (yours or AI-generated):

1. The OLD voice scripts are preserved in commit history (`git log docs/STORYBOARD.md`, look at commits before 2026-05-08).
2. Each old SAY block maps to one or two CAPTION cards in this v2 — feed those into ElevenLabs / Play.ht / Murf with the matching timing.
3. ElevenLabs free tier: ~10K characters/month. Full script is ~500 words ≈ 3K characters. One free month does the whole demo.
4. If keeping captions when you add voice, you can either: (a) tighten captions to short reinforcements ["MCP server: vtex-store"] and let voice carry detail, or (b) keep this full caption track as accessibility/mute-mode.

## Word budgets

This v2 has no voice. Captions land at viewers' reading pace (~3–4 words/second), not speech pace. Approximate caption-text totals:

| Scene | Duration | Caption words |
|---|---|---|
| 1 | 44s | ~75 |
| 2 | 30s | ~30 |
| 3 | 70s | ~95 |
| 4 | 25s | ~50 |
| 5 | 30s | ~40 |
| 6 | 26s | ~55 |
| 7 | 15s | ~30 |
| **Total** | **240s** | **~375 caption words** |
