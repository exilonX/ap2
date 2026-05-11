# Demo Storyboard — Agent Commerce Gateway (AP2 case study)

> **Format for reading aloud:** every beat has a SHOW block (stage directions) and a SAY block (the exact words to read). Read straight down. SHOW = what's on screen. SAY = what comes out of your mouth.

**Runtime:** 4:00. **Voice + captions paired.** Voice carries narrative; captions reinforce technical detail.

---

## Pre-flight checklist

- [ ] Adapter linked (`vtex link` from `packages/vtex-io-adapter`)
- [ ] App settings populated (`acgAllowedOrigins`, `acgAuthToken`, LLM keys, Pinecone keys)
- [ ] Claude Desktop config has `ACG_AUTH_TOKEN`; fully quit + reopen
- [ ] MCP server built; `dist/apps/checkout.html` is the latest version
- [ ] All three `.well-known/did.json` URLs resolve in browser
- [ ] Storefront has shipping address + customer profile pre-set
- [ ] Browser tabs ready: three DID URLs pre-loaded, JSON-prettified
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

1. **Capture screens silently** for scenes 2–7 following the SHOW directions.
2. **Build Scene 1's montage** in post by extracting 6 short clips (1–1.5s each) from your scene 2–7 captures.
3. **Cut footage** to the timestamps below in DaVinci Resolve or CapCut.
4. **Record voice** while watching playback — read the SAY blocks straight down.
5. **Overlay captions** at the SAY beat moments. Hold ~2s after voice ends.

---

# SCENE 1 — Intro + montage + AP2 primer  ·  0:00 → 0:44

---

### Beat 1.1  ·  0:00 – 0:04  ·  Title slate

**SHOW:** Black background. Title text fades in centered:
> Agent Commerce on AP2
>
> *An implementation of Google's Agent Payments Protocol*

**CAPTION:** *(the title text IS the caption — keep it on screen for the full 4 seconds)*

**🎤 SAY:**
> "Agent commerce, signed and verifiable. Here's how I built it in four weeks."

---

### Beat 1.2  ·  0:04 – 0:12  ·  Rapid-cut montage (the hook)

**SHOW:** Six fast clips, 1.0 – 1.5 seconds each, crossfade between them. **All six clips are re-edits of footage you'll capture for scenes 2–7. You do not shoot anything new.**

| # | Clip source | What it shows |
|---|---|---|
| 1 | From Scene 2 | Romanian chat → `browseProducts` tool call expanding → product cards rendering |
| 2 | From Scene 3 | 4-step ceremony mid-reveal — step 3's 7-check checklist animating in |
| 3 | From Scene 4 | PaymentReceipt JSON, `verification.valid: true` highlighted |
| 4 | From Scene 4 closer | Three `.well-known/did.json` URLs side-by-side in a split view |
| 5 | From Scene 2 / widget | Mandate badge — *"Cryptographically signed by acg--miniprix.myvtex.com"* |
| 6 | From Scene 5 | Rejection receipt JSON — `approval_status: rejected` next to `verification.valid: true` |

**CAPTION:**
> **Agent commerce. Cryptographically verifiable.**

**🎤 SAY:**
> *(silent — let the visuals breathe under a single instrumental swell or sfx)*

---

### Beat 1.3  ·  0:12 – 0:20  ·  The problem

**SHOW:** Crossfade from montage to bold text on dark background:
> Who's responsible when an AI buys?

**CAPTION:**
> **Who's responsible when an AI buys?**

**🎤 SAY:**
> "AI agents are shopping on our behalf — sometimes with the user chatting in real time, sometimes autonomously while we sleep. Who's responsible when something goes wrong?"

---

### Beat 1.4  ·  0:20 – 0:28  ·  The two modes

**SHOW:** Two text-box overlays side by side on a neutral background:

| Human present | Human not present |
|---|---|
| User chats with the agent in real time. Confirms each step. | User pre-delegates authority. *"Buy these shoes when they drop below 80 RON."* |

**CAPTION:**
> **AP2 · Agent Payments Protocol · Google · v0.2**

**🎤 SAY:**
> "AP2 — Google's Agent Payments Protocol — covers both modes. Today's demo: human-present."

---

### Beat 1.5  ·  0:28 – 0:36  ·  Three actors, three keys

**SHOW:** Three boxes appearing left-to-right, each with a key icon and a DID URL:
> Merchant signs CartMandate  ·  `did:web:<store-host>`
>
> Credentials Provider signs PaymentMandate  ·  `did:web:<cp-host>`
>
> Network signs PaymentReceipt  ·  `did:web:<network-host>`

**CAPTION:**
> **3 actors · 3 private keys · 3 published DIDs**

**🎤 SAY:**
> "Three actors. Three private keys. The merchant signs the cart, the Credentials Provider signs the payment, the Network signs the receipt — each with their own Ed25519 key."

---

### Beat 1.6  ·  0:36 – 0:44  ·  MCP plumbing reveal

**SHOW:**
1. Quick cut (~2s) to Claude Desktop → Settings → Developer panel. **`vtex-store · running`** is visible.
2. Crossfade (~6s) to the Claude Desktop chat window, cursor blinking in the empty input.

**CAPTION:**
> **MCP server: `vtex-store` · live connection**

**🎤 SAY:**
> "The agent runs as an MCP server inside Claude Desktop, proxying tool calls to a VTEX IO backend. Let's start."

---

# SCENE 2 — Live shopping + RAG  ·  0:44 → 1:14

---

### Beat 2.1  ·  0:44 – 0:59  ·  Type and search

**SHOW:**
1. Type into Claude Desktop chat: *vreau o camasa si niste pantaloni pentru barbati*
2. Tool calls expand — `vtex-store: browseProducts` visible.
3. (Optional B-roll) Briefly flash that Pinecone is being queried via a caption.

**CAPTION:**
> **MCP → VTEX IO adapter · live catalog + Pinecone vector search**

**🎤 SAY:**
> "I ask the agent in Romanian for a shirt and some pants. The MCP tool call hits a VTEX IO adapter that queries both the live catalog and a Pinecone vector index. *Pantaloni lungi închiși la culoare* returns actual long dark pants — semantic search, not keyword matches."

---

### Beat 2.2  ·  0:59 – 1:14  ·  Render and add to cart

**SHOW:**
1. Product cards render in iframes inside the chat.
2. Click *Add to cart* on one shirt + one pair of pants.
3. Cart preview card appears in the chat with the running total in RON.

**CAPTION:**
> **Real merchant · Real prices · Real RON**

**🎤 SAY:**
> "The agent reads the results, renders product cards, adds two items to a real cart — on the same orderForm a human would have if they shopped natively in VTEX."

---

# SCENE 3 — Three-actor signing ceremony  ·  1:14 → 2:24

---

### Beat 3.1  ·  1:14 – 1:22  ·  Type "checkout"

**SHOW:**
1. Type *checkout* into chat.
2. Iframe opens. AP2 Security panel visible: mandate ID, merchant DID, cart hash, signed-at timestamp.

**CAPTION:**
> **Three actors · three signatures · three roles**

**🎤 SAY:**
> "I type checkout. Three actors enter the picture."

---

### Beat 3.2  ·  1:22 – 1:34  ·  Merchant signs CartMandate

**SHOW:** Camera lingers on the AP2 Security panel. Highlight the mandate ID and the merchant DID `did:web:acg--miniprix.myvtex.com`.

**CAPTION:**
> **Merchant signs CartMandate · `did:web:acg--miniprix.myvtex.com`**

**🎤 SAY:**
> "First, the Merchant. The VTEX store itself, identified by `did:web` pointing at `miniprix.myvtex.com`. The merchant signs the CartMandate: *I commit to selling exactly these items at this price.*"

---

### Beat 3.3  ·  1:34 – 1:39  ·  Click Pay Now + drift check

**SHOW:** Click the **Pay Now** button. Ceremony step 1 reveals with a green check: *Re-verify CartMandate against current cart.*

**CAPTION:**
> **Step 1 · re-hash live cart · drift detection (catches cart-tamper post-sign)**

**🎤 SAY:**
> "Pay Now. Step one — re-hash the live cart and compare to the signed mandate. Drift detection catches cart-tamper between sign and pay."

---

### Beat 3.4  ·  1:39 – 1:58  ·  CP signs PaymentMandate

**SHOW:** Ceremony step 2 reveals with a green check. (Optional 2s secondary caption overlay around 1:50 showing `agent_presence: { human_present: true }`.)

**CAPTION (primary):**
> **CP signs PaymentMandate · prod: Stripe / Adyen / PayPal / Google Pay**

**CAPTION (secondary, briefly):**
> `agent_presence: { human_present: true }` — H-N-P mode uses IntentMandate

**🎤 SAY:**
> "Second, the Credentials Provider. In production this is Stripe, Adyen, PayPal, or Google Pay — the party holding the user's card-on-file. Here, a mock CP. The CP signs the PaymentMandate, binding the cart hash to the payment hash."

---

### Beat 3.5  ·  1:58 – 2:15  ·  Network verifies, signs Receipt

**SHOW:** Ceremony step 3 reveals. The 7-check checklist animates in at 80ms intervals. **Do not speed up — this is the visual centerpiece.** Then step 4 reveals with order placed.

**CAPTION:**
> **Network verifies 7 properties · prod: Visa / Mastercard · signs PaymentReceipt**

**🎤 SAY:**
> "Third, the Payment Network. Visa or Mastercard in production. Here, a mock. The Network independently verifies seven separate properties — signatures, hash binding, amount, mandate IDs, expiries — then signs the PaymentReceipt."

---

### Beat 3.6  ·  2:15 – 2:24  ·  Final panel — three artifact links

**SHOW:** Final *Payment authorized · Order ACG-XXXX* panel. Three artifact buttons visible: **CartMandate · PaymentMandate · PaymentReceipt**.

**CAPTION:**
> **None can lie without the others noticing.**

**🎤 SAY:**
> "Three parties. Three roles. None can lie without the others noticing."

---

# SCENE 4 — Independent verification  ·  2:24 → 2:49

The strongest single beat for AP2 credibility. The viewer must feel that **three different parties hold three different private keys**, none of which can sign on each other's behalf.

---

### Beat 4.1  ·  2:24 – 2:31  ·  CartMandate JSON

**SHOW:** Click the CartMandate link. Browser opens JSON. Highlight `merchant_authorization` (the JWT), `verification.valid: true`, `signedBy: did:web:acg--miniprix.myvtex.com`.

**CAPTION:**
> **CartMandate · signed with merchant's private key · public key at `/.well-known/did.json`**

**🎤 SAY:**
> "The CartMandate. This JWT was signed by the merchant's private Ed25519 key. Their public key sits at a published `.well-known` URL — anyone can fetch it and verify this signature."

---

### Beat 4.2  ·  2:31 – 2:37  ·  PaymentMandate JSON

**SHOW:** Click the PaymentMandate link. Browser opens JSON. Highlight `user_authorization` JWT, `cp_did`, and `payment_response.details.token`.

**CAPTION:**
> **PaymentMandate · CP's private key · prod: Stripe / Adyen / PayPal / Google Pay**

**🎤 SAY:**
> "The PaymentMandate. Signed by the Credentials Provider with their own private key — different party, different key. In production: Stripe, Adyen, PayPal, or Google Pay."

---

### Beat 4.3  ·  2:37 – 2:43  ·  PaymentReceipt JSON

**SHOW:** Click the PaymentReceipt link. Browser opens JSON. Highlight `approval_status: "approved"`, all 7 `verification_checks: true`, `network_authorization` JWT, `network_did`.

**CAPTION:**
> **PaymentReceipt · Network's private key · prod: Visa / Mastercard · 7/7 ✓**

**🎤 SAY:**
> "The PaymentReceipt. Signed by the Network with theirs — third party, third key. In production: Visa or Mastercard."

---

### Beat 4.4  ·  2:43 – 2:49  ·  Three DID documents side-by-side

**SHOW:** Split-screen the three `.well-known/did.json` URLs. Three visibly different `publicKeyHex` values on screen.

**CAPTION:**
> **3 private keys · 3 published public keys · 3 different parties · zero shared trust**

**🎤 SAY:**
> "Three private keys, held by three different parties. Three public keys, at three different URLs. Verification needs no SDK and no trust — just the URLs."

---

# SCENE 5 — Rejection branch (the punchline)  ·  2:49 → 3:19

The single strongest beat. The contradiction (rejected + valid) must land in near-silence.

---

### Beat 5.1  ·  2:49 – 2:54  ·  New cart, open checkout

**SHOW:** Reset to Claude Desktop. New cart. Type *checkout*. Iframe re-opens.

**CAPTION:**
> **What if a check fails?**

**🎤 SAY:**
> "Now — what happens when something goes wrong?"

---

### Beat 5.2  ·  2:54 – 3:02  ·  Click force-reject

**SHOW:** Click the small grey **`(force reject — staging only)`** link below the Pay Now button.

**CAPTION:**
> **Force-reject (staging only) · fails `payment_mandate_not_expired`**

**🎤 SAY:**
> "In production: insufficient funds, fraud flag, 3DS step-up failure. Here I force the Network to fail one check."

---

### Beat 5.3  ·  3:02 – 3:09  ·  6 green + 1 red

**SHOW:** Ceremony plays through. Steps 1 and 2 succeed. Step 3 reveals 6 green checks plus 1 red ✗ on `payment_mandate_not_expired`. Step 4 marks failed.

**CAPTION:**
> **6 ✓ + 1 ✗ · Network rejected**

**🎤 SAY:**
> "Steps one and two succeed. Step three: six green, one red. The Network rejected."

---

### Beat 5.4  ·  3:09 – 3:19  ·  The contradiction. **Music drops to silence here.**

**SHOW:** Click the PaymentReceipt link. JSON opens. **Both `approval_status: "rejected"` AND `verification.valid: true` are visible at the top level — highlight both.**

**CAPTION:**
> **`approval_status: rejected` · `verification.valid: true` · always-emit invariant**

**🎤 SAY:**
> "The receipt. Payment rejected — *but the receipt itself is cryptographically valid*. The Network signed the rejection. Today a decline is a string from the acquirer's logs. Tomorrow, it's evidence anyone can verify."

---

# SCENE 6 — Architecture + RAG  ·  3:19 → 3:45

---

### Beat 6.1  ·  3:19 – 3:30  ·  Architecture diagram

**SHOW:** Navigate to the case study page on your portfolio site. Scroll to the architecture diagram section. Camera lingers on the three identity boxes (Merchant / CP / Network). Pan across to show the Pinecone, OpenAI, Anthropic boxes.

> **Reuse the existing SVG diagram from the case study page.** No new image needed.

**CAPTION:**
> **VTEX IO · Pinecone · OpenAI · Anthropic · 3 identities · 3 DIDs**

**🎤 SAY:**
> "Behind the scenes — a VTEX IO adapter serves all the routes. Pinecone holds vector embeddings of the catalog so semantic queries work. OpenAI handles embeddings, Anthropic runs the chat loop."

---

### Beat 6.2  ·  3:30 – 3:45  ·  Production swap-in

**SHOW:** Stay on the diagram. Highlight the three identity boxes — Merchant / mock CP / mock Network. Then visually swap (or just speak) the production equivalents.

**CAPTION:**
> **3 identities · production swap-in: Stripe / Adyen / PayPal / Google Pay · Visa / Mastercard**

**🎤 SAY:**
> "Three cryptographic identities — merchant, mock CP, mock Network — each with its own `did:web`. In production, swap the mocks for Stripe and Visa. Orchestration code doesn't change. Backend-agnostic — same engine runs on Shopify, BigCommerce, or any headless setup."

---

# SCENE 7 — Compliance + commercial CTA  ·  3:45 → 4:00

---

### Beat 7.1  ·  3:45 – 3:53  ·  Compliance summary

**SHOW:** Plain dark background. Text appears:

> AP2 v0.2 · EdDSA Ed25519 · JCS (RFC 8785) · did:web
>
> Human-present shipped · IntentMandate next · Production CP swap-in ready

**CAPTION:**
> **AP2 v0.2 · human-present shipped · IntentMandate (H-N-P) next**

**🎤 SAY:**
> "AP2 v0.2 spec-faithful for the human-present flow. IntentMandate next for human-not-present. Production CP swap-in ready."

---

### Beat 7.2  ·  3:53 – 4:00  ·  CTA + portfolio URL

**SHOW:** Portfolio URL prominent on screen:

> **Want this on your store?**
>
> github.com/exilonX/ap2  ·  [your-portfolio.com/ap2-case-study]

**CAPTION:**
> **Source-available under BSL 1.1 · github.com/exilonX/ap2 · book a call to deploy**

**🎤 SAY:**
> "Source under BSL. Book a call if you want this on your store. Link below."

Hold the final frame for 1.5 seconds before fade-out.

---

## Editing notes

- **Cut every dead second.** Voice script assumes tight cuts.
- **Speed up JSON scrolling** in scenes 4 and 5 to 1.5×.
- **Highlight key fields** in JSON with colored rectangles or zoom-ins.
- **The 7-check reveal in Beat 3.5:** never speed up — slow to 0.85× if needed.
- **Music:** instrumental, –18 dB. **Cut entirely** under Beat 5.4's contradiction.
- **Caption styling:** monospace for technical fields (`did:web:…`, `cart_hash:`). Sans-serif for prose.

## Voice delivery tips

- **Tempo:** slower than feels natural. Conversational, not announcer.
- **Emphasis:** lean on the contrast in Beat 5.4 — *"Payment rejected. **But** the receipt itself is cryptographically valid."* The "but" earns a micro-pause.
- **Actor names:** in Scene 3 and 4, slow down on "Stripe, Adyen, PayPal, Google Pay" and "Visa, Mastercard" — those names anchor unfamiliar terminology to the viewer's existing mental model.
- **Tone:** matter-of-fact, not hype.
- **Re-takes:** Scenes 1, 3, 5 are the most dense. Plan 3+ takes each.

## Word budgets (sanity check)

| Scene | Duration | Spoken words | Pace |
|---|---|---|---|
| 1 | 44s | ~80 (montage silent) | 2.5 wps in voiced beats |
| 2 | 30s | ~70 | 2.3 wps |
| 3 | 70s | ~125 | 1.8 wps (animation pauses) |
| 4 | 25s | ~65 | 2.6 wps |
| 5 | 30s | ~60 | 2.0 wps |
| 6 | 26s | ~60 | 2.3 wps |
| 7 | 15s | ~30 | 2.0 wps |
| **Total** | **240s** | **~490 words** | |
