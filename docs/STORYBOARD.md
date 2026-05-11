# Demo Storyboard — Agent Commerce Gateway (AP2 case study)

> **Format for reading aloud:** every beat is one card with three blocks — STAGE (what's happening), CAPTION (overlay text), and **🎤 SAY** (the exact words to read). Read straight down.

> **Every beat is tagged 🔴 REC or 🟦 POST** so you know which moments need a live screen capture and which are assembled in the editor.
>
> 🔴 **REC** — Live screen capture during the recording session. You actually do this action on screen.
> 🟦 **POST** — Assembled in editor after recording (title slates, montage cuts, text overlays, animated graphics).

**Runtime:** 4:00. Voice + captions paired.

---

## Pre-flight checklist (before you hit record)

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

- **Voice + captions** paired from take 1.
- **English captions** only. User-typed Romanian stays Romanian.
- **Camera:** screen-only, no face cam.
- **Workspace:** `acg / miniprix`.
- **Repo strategy:** BSL public on GitHub, case study lives on portfolio.
- **CTA:** commercial — "book a call to deploy on your store."

## Recording workflow

**Step 1 — Capture all 🔴 REC beats.** Record continuous-take screen captures of each REC scene. You don't need to capture beats in script order; just make sure every REC beat below ends up on disk.

**Step 2 — Build the 🟦 POST beats.** Title slates, text overlays, the Scene 1 montage, the two-mode split-screen, the three-actor diagram, the closing CTA card — all of these are assembled in your editor from text, color blocks, or extracts of your REC footage.

**Step 3 — Lay everything onto the timeline** at the timestamps below.

**Step 4 — Record voice over the silent edit.** Read the 🎤 SAY blocks straight down. Multiple takes for dense scenes (3 and 5).

**Step 5 — Overlay captions** at the SAY moments. Hold ~2s after voice ends.

---

# SCENE 1 — Intro + montage + AP2 primer  ·  0:00 → 0:44

---

### Beat 1.1  ·  0:00 – 0:04  ·  Title slate  ·  🟦 POST

**STAGE:** Editor-built. Black background. Title text fades in centered:
> Agent Commerce on AP2
>
> *An implementation of Google's Agent Payments Protocol*

**CAPTION:** *(the title text IS the caption — keep it on screen for the full 4 seconds)*

**🎤 SAY:**
> "Agent commerce, signed and verifiable. Here's how I built it in four weeks."

---

### Beat 1.2  ·  0:04 – 0:12  ·  Rapid-cut montage (the hook)  ·  🟦 POST

**STAGE:** Editor-built. Six clips, 1.0 – 1.5 seconds each, crossfade between them. **Every clip is an extract from REC footage you captured for Scenes 2 – 5.** Nothing new is captured for this beat.

| # | Clip source (from your REC footage) | What it shows |
|---|---|---|
| 1 | Scene 2 capture | Romanian chat → `browseProducts` tool call expanding → product cards rendering |
| 2 | Scene 3 capture | 4-step ceremony mid-reveal — step 3's 7-check checklist animating in |
| 3 | Scene 4 capture | PaymentReceipt JSON, `verification.valid: true` highlighted |
| 4 | Scene 4 closer capture | Three `.well-known/did.json` URLs side-by-side in a split view |
| 5 | Scene 2 / widget capture | Mandate badge — *"Cryptographically signed by acg--miniprix.myvtex.com"* |
| 6 | Scene 5 capture | Rejection receipt JSON — `approval_status: rejected` next to `verification.valid: true` |

**CAPTION:**
> **Agent commerce. Cryptographically verifiable.**

**🎤 SAY:**
> *(silent — let the visuals breathe under a single instrumental swell or sfx)*

---

### Beat 1.3  ·  0:12 – 0:20  ·  The problem  ·  🟦 POST

**STAGE:** Editor-built. Crossfade from montage to bold text on dark background:
> Who's responsible when an AI buys?

**CAPTION:**
> **Who's responsible when an AI buys?**

**🎤 SAY:**
> "AI agents are shopping on our behalf — sometimes with the user chatting in real time, sometimes autonomously while we sleep. Who's responsible when something goes wrong?"

---

### Beat 1.4  ·  0:20 – 0:28  ·  The two modes  ·  🟦 POST

**STAGE:** Editor-built. Two text-box overlays side by side on a neutral background:

| Human present | Human not present |
|---|---|
| User chats with the agent in real time. Confirms each step. | User pre-delegates authority. *"Buy these shoes when they drop below 80 RON."* |

**CAPTION:**
> **AP2 · Agent Payments Protocol · Google · v0.2**

**🎤 SAY:**
> "AP2 — Google's Agent Payments Protocol — covers both modes. Today's demo: human-present."

---

### Beat 1.5  ·  0:28 – 0:36  ·  Three actors, three keys  ·  🟦 POST

**STAGE:** Editor-built. Three boxes appearing left-to-right, each with a key icon and a DID URL:
> Merchant signs CartMandate  ·  `did:web:<store-host>`
>
> Credentials Provider signs PaymentMandate  ·  `did:web:<cp-host>`
>
> Network signs PaymentReceipt  ·  `did:web:<network-host>`

**CAPTION:**
> **3 actors · 3 private keys · 3 published DIDs**

**🎤 SAY:**
> "Three actors. Three private keys. The merchant signs the cart, the Credentials Provider — like Stripe or Apple Pay — signs the payment, and the Network — Visa or Mastercard — signs the receipt. Each with their own Ed25519 key."

---

### Beat 1.6  ·  0:36 – 0:44  ·  MCP plumbing reveal + tool surface  ·  🔴 REC

**STAGE:** Live screen capture. Two sub-shots, no dead air:

1. **(0:36–0:39, ~3s):** In Claude Desktop, open Settings → Developer. **`vtex-store · running`** is visible. Hold for the voice line that names the MCP server.
2. **(0:39–0:44, ~5s):** Close Settings. **Click the tools / "Search and tools" icon** in the Claude Desktop chat input bar so the list of MCP tools opens. The tools list shows `browseProducts`, `addToCart`, `getCart`, `checkoutInChat`, `executePayment`, etc. Camera lingers on the list while the voice names them. Cursor jumps into the chat input on the last beat to set up Scene 2.

> **Why the tool list matters:** these are the only things the agent can do. They're explicit, enumerable, auditable — not "the agent has access to your store." Showing them on screen makes the trust surface concrete.

**CAPTION:**
> **MCP server: `vtex-store` · running · 16 tools exposed (search, cart, checkout, payment)**

**🎤 SAY:**
> "The agent runs as an MCP server inside Claude Desktop. Here are the tools it exposes — search, cart, checkout, AP2 payment. Nothing more. Let's start."

---

# SCENE 2 — Live shopping + RAG  ·  0:44 → 1:14

---

### Beat 2.1  ·  0:44 – 0:59  ·  Type and search  ·  🔴 REC

**STAGE:** Live screen capture inside Claude Desktop.
1. Type into chat: *vreau o camasa si niste pantaloni pentru barbati*
2. Hit enter. Wait for the tool calls to expand — `vtex-store: browseProducts` becomes visible.
3. Let the tool-call expansion stay open for ~3 seconds.

**CAPTION:**
> **MCP → VTEX IO adapter · live catalog + Pinecone vector search**

**🎤 SAY:**
> "I ask the agent in Romanian for a shirt and some pants. The MCP tool call hits a VTEX IO adapter that queries both the live catalog and a Pinecone vector index. *Pantaloni lungi închiși la culoare* returns actual long dark pants — semantic search, not keyword matches."

---

### Beat 2.2  ·  0:59 – 1:14  ·  Render and add to cart  ·  🔴 REC

**STAGE:** Continue live capture.
1. Product cards render in iframes inside the chat. Wait for the images to load.
2. Click *Add to cart* on one shirt.
3. Click *Add to cart* on one pair of pants.
4. Cart preview card appears with the running total in RON.

**CAPTION:**
> **Real merchant · Real prices · Real RON**

**🎤 SAY:**
> "The agent reads the results, renders product cards, adds two items to a real cart — on the same orderForm a human would have if they shopped natively in VTEX."

---

# SCENE 3 — Three-actor signing ceremony  ·  1:14 → 2:24

---

### Beat 3.1  ·  1:14 – 1:22  ·  Type "checkout"  ·  🔴 REC

**STAGE:** Live capture.
1. Type *checkout* into chat. Hit enter.
2. The iframe opens with cart preview + AP2 Security panel.
3. Hold camera on the iframe top section so the mandate id, merchant DID, and cart hash are visible.

**CAPTION:**
> **Three actors · three signatures · three roles**

**🎤 SAY:**
> "I type checkout. Three actors enter the picture."

---

### Beat 3.2  ·  1:22 – 1:34  ·  Merchant signs CartMandate  ·  🔴 REC

**STAGE:** Camera lingers on the AP2 Security panel. **Optional:** zoom or highlight overlay on the mandate id and `did:web:acg--miniprix.myvtex.com` (the highlight overlay itself is POST, but the underlying frame is REC).

**CAPTION:**
> **Merchant signs CartMandate · `did:web:acg--miniprix.myvtex.com`**

**🎤 SAY:**
> "First, the Merchant. The VTEX store itself, identified by `did:web` pointing at `miniprix.myvtex.com`. The merchant signs the CartMandate: *I commit to selling exactly these items at this price.*"

---

### Beat 3.3  ·  1:34 – 1:39  ·  Click Pay Now + drift check  ·  🔴 REC

**STAGE:** Live capture.
1. Click **Pay Now** button.
2. Ceremony Step 1 reveals with a green check next to *"Re-verify CartMandate against current cart."*

**CAPTION:**
> **Step 1 · re-hash live cart · drift detection (catches cart-tamper post-sign)**

**🎤 SAY:**
> "Pay Now. Step one — re-hash the live cart and compare to the signed mandate. Drift detection catches cart-tamper between sign and pay."

---

### Beat 3.4  ·  1:39 – 1:58  ·  CP signs PaymentMandate  ·  🔴 REC

**STAGE:** Continue capture. Ceremony Step 2 reveals with a green check.

The Credentials Provider is the party that **holds the user's card** and **confirms the user authorized the payment** — distinct from the Network, which only sees the cryptographic chain. In production: Stripe, Adyen, PayPal, Apple Pay, Google Pay.

**CAPTION (primary):**
> **CP signs PaymentMandate · holds user's card · prod: Stripe / Adyen / PayPal / Apple Pay / Google Pay**

**CAPTION (secondary, briefly around 1:50):**
> `agent_presence: { human_present: true }` — H-N-P mode uses IntentMandate

**🎤 SAY:**
> "Second, the Credentials Provider. The party holding the user's card-on-file — Stripe, Adyen, PayPal, or Apple Pay in production. The CP signs the PaymentMandate, confirming the user authorized this payment and binding the cart hash to the payment hash."

---

### Beat 3.5  ·  1:58 – 2:15  ·  Network verifies, signs Receipt  ·  🔴 REC

**STAGE:** Continue capture. Ceremony Step 3 reveals — the 7-check checklist animates in at 80ms intervals. **Do not speed up in post.** Then Step 4 reveals with order placed.

The Payment Network is **a different party from the CP** — they only see the signed chain, not the user. Their independent verification is what makes the receipt credible. In production: Visa, Mastercard.

**CAPTION:**
> **Network verifies 7 properties · independent third party · prod: Visa / Mastercard**

**🎤 SAY:**
> "Third, the Payment Network. A different party from the CP — they don't know the user, only the signed chain. Visa or Mastercard in production. The Network independently verifies seven separate properties — signatures, hash binding, amount, mandate IDs, expiries — then signs the PaymentReceipt."

---

### Beat 3.6  ·  2:15 – 2:24  ·  Final panel — three artifact links  ·  🔴 REC

**STAGE:** Final *Payment authorized · Order ACG-XXXX* panel visible. Three artifact buttons in view: **CartMandate · PaymentMandate · PaymentReceipt**.

**CAPTION:**
> **None can lie without the others noticing.**

**🎤 SAY:**
> "Three parties. Three roles. None can lie without the others noticing."

---

# SCENE 4 — Independent verification  ·  2:24 → 2:49

The strongest single beat for AP2 credibility. The viewer must feel that **three different parties hold three different private keys**, none of which can sign on each other's behalf.

---

### Beat 4.1  ·  2:24 – 2:31  ·  CartMandate JSON  ·  🔴 REC

**STAGE:** Live capture.
1. Click the **CartMandate** link in the iframe. New browser tab opens with the JSON.
2. Camera scrolls through the JSON. **Optional POST overlay:** colored rectangle highlighting `merchant_authorization` (the JWT), `verification.valid: true`, `signedBy: did:web:acg--miniprix.myvtex.com`.

**CAPTION:**
> **CartMandate · signed with merchant's private key · public key at `/.well-known/did.json`**

**🎤 SAY:**
> "The CartMandate. This JWT was signed by the merchant's private Ed25519 key. Their public key sits at a published `.well-known` URL — anyone can fetch it and verify this signature."

---

### Beat 4.2  ·  2:31 – 2:37  ·  PaymentMandate JSON  ·  🔴 REC

**STAGE:** Live capture.
1. Click the **PaymentMandate** link. New browser tab opens.
2. Scroll through. **Optional POST overlay:** highlight `user_authorization` JWT, `cp_did`, `payment_response.details.token`.

**CAPTION:**
> **PaymentMandate · CP's private key · prod: Stripe / Adyen / PayPal / Google Pay**

**🎤 SAY:**
> "The PaymentMandate. Signed by the Credentials Provider with their own private key — different party, different key. In production: Stripe, Adyen, PayPal, or Apple Pay."

---

### Beat 4.3  ·  2:37 – 2:43  ·  PaymentReceipt JSON  ·  🔴 REC

**STAGE:** Live capture.
1. Click the **PaymentReceipt** link. New browser tab opens.
2. **Optional POST overlay:** highlight `approval_status: "approved"`, all 7 `verification_checks: true`, `network_authorization` JWT, `network_did`.

**CAPTION:**
> **PaymentReceipt · Network's private key · prod: Visa / Mastercard · 7/7 ✓**

**🎤 SAY:**
> "The PaymentReceipt. Signed by the Network with theirs — third party, third key. In production: Visa or Mastercard."

---

### Beat 4.4  ·  2:43 – 2:49  ·  Three DID documents side-by-side  ·  🔴 REC + 🟦 POST overlay

**STAGE:**
1. **REC:** open the three `.well-known/did.json` URLs in three browser tabs (or one window split-screen — pre-arranged in pre-flight).
2. **POST overlay:** colored boxes highlighting the three different `publicKeyHex` values so the eye instantly sees they're different.

**CAPTION:**
> **3 private keys · 3 published public keys · 3 different parties · zero shared trust**

**🎤 SAY:**
> "Three private keys, held by three different parties. Three public keys, at three different URLs. Verification needs no SDK and no trust — just the URLs."

---

# SCENE 5 — Rejection branch (the punchline)  ·  2:49 → 3:19

The single strongest beat. The contradiction (rejected + valid) must land in near-silence.

---

### Beat 5.1  ·  2:49 – 2:54  ·  New cart, open checkout  ·  🔴 REC

**STAGE:** Live capture.
1. Reset to Claude Desktop. Start a new cart (or use a different shopping flow).
2. Type *checkout*. Iframe re-opens.

**CAPTION:**
> **What if a check fails?**

**🎤 SAY:**
> "Now — what happens when something goes wrong?"

---

### Beat 5.2  ·  2:54 – 3:02  ·  Click force-reject  ·  🔴 REC

**STAGE:** Live capture. Click the small grey **`(force reject — staging only)`** link below the Pay Now button.

**CAPTION:**
> **Force-reject (staging only) · fails `payment_mandate_not_expired`**

**🎤 SAY:**
> "In production: insufficient funds, fraud flag, 3DS step-up failure. Here I force the Network to fail one check."

---

### Beat 5.3  ·  3:02 – 3:09  ·  6 green + 1 red  ·  🔴 REC

**STAGE:** Continue capture. Ceremony plays. Steps 1 and 2 succeed. Step 3 reveals 6 green checks + 1 red ✗ on `payment_mandate_not_expired`. Step 4 marks failed.

**CAPTION:**
> **6 ✓ + 1 ✗ · Network rejected**

**🎤 SAY:**
> "Steps one and two succeed. Step three: six green, one red. The Network rejected."

---

### Beat 5.4  ·  3:09 – 3:19  ·  The contradiction  ·  🔴 REC + 🟦 POST overlay

**STAGE:**
1. **REC:** click the **PaymentReceipt** link. JSON opens in browser.
2. **POST overlay:** strong colored boxes around BOTH `approval_status: "rejected"` AND `verification.valid: true` at the top level — the viewer must see both at the same time.
3. **Music drops to silence in this beat.** The contradiction lands harder in silence with just the voice.

**CAPTION:**
> **`approval_status: rejected` · `verification.valid: true` · always-emit invariant**

**🎤 SAY:**
> "The receipt. Payment rejected — *but the receipt itself is cryptographically valid*. The Network signed the rejection. Today a decline is a string from the acquirer's logs. Tomorrow, it's evidence anyone can verify."

---

# SCENE 6 — Architecture + RAG  ·  3:19 → 3:45

---

### Beat 6.1  ·  3:19 – 3:30  ·  Architecture diagram (from case study)  ·  🔴 REC

**STAGE:** Live capture.
1. Navigate to the case study page on your portfolio site (open in a tab pre-flight).
2. Scroll to the architecture diagram section (the three-party trust chain SVG).
3. Camera lingers on the three identity boxes. Pan across to show Pinecone, OpenAI, Anthropic boxes.

> **Reuse the existing SVG diagram from the case study page.** No new image asset needed.

**CAPTION:**
> **VTEX IO · Pinecone · OpenAI · Anthropic · 3 identities · 3 DIDs**

**🎤 SAY:**
> "Behind the scenes — a VTEX IO adapter serves all the routes. Pinecone holds vector embeddings of the catalog so semantic queries work. OpenAI handles embeddings, Anthropic runs the chat loop."

---

### Beat 6.2  ·  3:30 – 3:45  ·  Production swap-in  ·  🔴 REC

**STAGE:** Stay scrolled on the diagram. Camera pans to / highlights the three identity boxes (Merchant / mock CP / mock Network).

**CAPTION:**
> **3 identities · production swap-in: Stripe / Adyen / PayPal / Google Pay · Visa / Mastercard**

**🎤 SAY:**
> "Three cryptographic identities — merchant, mock CP, mock Network — each with its own `did:web`. In production, swap the mocks for Stripe and Visa. Orchestration code doesn't change. Backend-agnostic — same engine runs on Shopify, BigCommerce, or any headless setup."

---

# SCENE 7 — Compliance + commercial CTA  ·  3:45 → 4:00

---

### Beat 7.1  ·  3:45 – 3:53  ·  Compliance summary  ·  🟦 POST

**STAGE:** Editor-built. Plain dark background. Text appears:

> AP2 v0.2 · EdDSA Ed25519 · JCS (RFC 8785) · did:web
>
> Human-present shipped · IntentMandate next · Production CP swap-in ready

**CAPTION:**
> **AP2 v0.2 · human-present shipped · IntentMandate (H-N-P) next**

**🎤 SAY:**
> "AP2 v0.2 spec-faithful for the human-present flow. IntentMandate next for human-not-present. Production CP swap-in ready."

---

### Beat 7.2  ·  3:53 – 4:00  ·  CTA + portfolio URL  ·  🟦 POST

**STAGE:** Editor-built. Plain dark background. Portfolio URL prominent on screen:

> **Want this on your store?**
>
> github.com/exilonX/ap2  ·  [your-portfolio.com/ap2-case-study]

**CAPTION:**
> **Source-available under BSL 1.1 · github.com/exilonX/ap2 · book a call to deploy**

**🎤 SAY:**
> "Source under BSL. Book a call if you want this on your store. Link below."

Hold the final frame for 1.5 seconds before fade-out.

---

## What you actually capture vs build

Quick reference — what each tag means in practice:

| Tag | What you do | Tools |
|---|---|---|
| 🔴 **REC** | Open the actual app (Claude Desktop, browser, portfolio site). Perform the action. Record screen. | OBS, built-in screen recorder |
| 🟦 **POST** | Type text into a video editor's title-card / overlay tool. Or arrange clips you already captured. | DaVinci Resolve, CapCut, Final Cut |

Counting the storyboard:

- **🔴 REC beats:** 14 (Scenes 2, 3, 4, 5, 6 entirely + Scene 1's MCP plumbing reveal)
- **🟦 POST beats:** 7 (Scene 1's title slate, montage, problem text, two modes, three actors; Scene 7's compliance card + CTA card)
- **Hybrid (REC base + POST overlay):** Beats 4.4 and 5.4 — record the screen, then add colored highlight boxes in post

---

## Editing notes

- **Cut every dead second.** Voice script assumes tight cuts.
- **Speed up JSON scrolling** in scenes 4 and 5 to 1.5×.
- **Highlight key fields** in JSON with POST-overlay colored rectangles or zoom-ins.
- **The 7-check reveal in Beat 3.5:** never speed up — slow to 0.85× if the voice line doesn't fit.
- **Music:** instrumental, –18 dB. **Cut entirely** under Beat 5.4's contradiction.
- **Caption styling:** monospace for technical fields (`did:web:…`, `cart_hash:`). Sans-serif for prose.

## Voice delivery tips

- **Tempo:** slower than feels natural. Conversational, not announcer.
- **Emphasis:** lean on the contrast in Beat 5.4 — *"Payment rejected. **But** the receipt itself is cryptographically valid."* The "but" earns a micro-pause.
- **Actor names:** in Scenes 3 and 4, slow down on "Stripe, Adyen, PayPal, Apple Pay" and "Visa, Mastercard" — these names anchor unfamiliar terminology to the viewer's existing mental model.
- **Tone:** matter-of-fact, not hype.
- **Re-takes:** Scenes 1, 3, 5 are the most dense. Plan 3+ takes each.

## Word budgets

| Scene | Duration | Spoken words | Pace |
|---|---|---|---|
| 1 | 44s | ~85 (montage silent) | 2.5 wps in voiced beats |
| 2 | 30s | ~70 | 2.3 wps |
| 3 | 70s | ~125 | 1.8 wps (animation pauses) |
| 4 | 25s | ~65 | 2.6 wps |
| 5 | 30s | ~60 | 2.0 wps |
| 6 | 26s | ~60 | 2.3 wps |
| 7 | 15s | ~30 | 2.0 wps |
| **Total** | **240s** | **~495 words** | |
