# Editing Guide — AP2 Case Study Video

> **Audience:** the person at the editor, post-shoot.
> **Goal:** turn 5 scenes of raw footage (~6:30 total) into a polished 4:00 case-study video.
> **Companion to:** `docs/STORYBOARD.md` (the shooting script).

---

## Target structure

| Scene | Raw footage | Cut target | Purpose |
|---|---|---|---|
| **0 — Title + hook** | (built in editor) | 0:00 – 0:10 | Establishing card + 1-line hook |
| **1 — Setup / MCP plumbing** | Scene 1 footage | 0:10 – 0:35 | Claude Desktop opens, dev panel shows `vtex-store: running`, tool list visible |
| **2 — Shopping + checkout (Claude Desktop)** | Scene 2 (1:54 raw) | 0:35 – 1:35 | Search → add → cart → checkout → mandate signed → Pay Now click |
| **3 — Three signed artifacts** | Scene 3 (0:47 raw) | 1:35 – 2:10 | Open each of the 3 JSON tabs; highlight `verification.valid: true` |
| **4 — Force-reject (the punchline)** | Scene 4 (1:37 raw) | 2:10 – 2:55 | Drift demo, force-reject ceremony, rejection receipt = cryptographically valid |
| **5 — Widget surface (brief)** | Scene 5 (2:09 raw) | 2:55 – 3:15 | Same backend, different UI. Show widget chat → mandate → CTA |
| **6 — Architecture + RAG** | (built in editor) | 3:15 – 3:40 | Diagram from case study page |
| **7 — Compliance + CTA** | (built in editor) | 3:40 – 4:00 | BSL + repo URL + book a call |

**Total: 4:00 exactly.** You'll need aggressive trimming on Scene 2, 4, and especially Scene 5 (cut from 2:09 to 20 sec).

---

## Tool: DaVinci Resolve (free)

- **Why:** professional-grade, free, handles everything you need (cuts, speed effects, captions, color, audio mix). Available on Windows/Mac/Linux. The CapCut alternative works but its caption tooling is weaker for technical content.
- **Download:** https://www.blackmagicdesign.com/products/davinciresolve (free version is the same app with a few pro-only codecs disabled — irrelevant here)
- **Project settings to use:**
  - Resolution: **1920×1080** (matches your screen captures)
  - Frame rate: **30 fps** (or 60 fps if you captured at that — match the source to avoid stutter)
  - Color science: default (Rec.709)
- **Workspace pages you'll use:**
  - **Edit page** — main cutting, captions, transitions
  - **Fairlight page** — audio mixing, voice ducking (if you record voice later)
  - **Deliver page** — export

---

## Workflow (one-time, top to bottom)

1. **Import the 5 clips** into Media Pool (drag from your folder).
2. **Create a new timeline:** 1920×1080, 30 fps. Drop the clips in scene order on track V1.
3. **Quick first cut:** scrub through each clip, mark in/out points to roughly hit the cut targets above. Don't perfect it — just get to ~4:30 of rough cut.
4. **Tighten dead air:** every place where you waited for a load / tool call / animation to start, cut 80% of that wait. Tool: select the dead region, press `Backspace` (Delete leaves a gap). Aim for 4:00.
5. **Add caption track (V2):** every beat below gets a text overlay. Use the Text+ effect (Effects → Toolbox → Titles → Text+). Drop it on V2 above the relevant footage region. Style guide below.
6. **Speed up JSON scrolling:** for Scenes 3 and 4, the moments where you scroll through JSON, select the clip → Inspector → Speed → 150% or 200%. Audio gets muted automatically for speed > 100%.
7. **Highlights and zooms:** Inspector → Transform → Zoom 1.3-1.5x with a small position offset to "zoom into" key JSON fields. Add a colored Rectangle (Effects → Toolbox → Generators → Solid Color or a Fusion shape) with semi-transparent fill + colored outline around the highlighted field.
8. **Add music** (next section).
9. **Export from Deliver page** with the settings at the bottom.

---

## Per-scene editing instructions

### Scene 0 — Title + hook (0:00 – 0:10, built in editor)

**Visuals:**
- Black background
- Title text fades in centered at 0:02

**Title text** (use a clean sans-serif, 64-80px):

```
Agent Commerce on AP2

An implementation of Google's Agent Payments Protocol
Signed and verifiable. Built in 4 weeks.
```

**Effect:** fade in 400ms, hold 6s, fade out 400ms.

**Music:** starts at 0:00 quietly, builds to -16 dB by 0:08.

---

### Scene 1 — Setup / MCP plumbing (0:10 – 0:35, from Scene 1 footage)

**What's in the raw footage:** Claude Desktop window, opening Settings → Developer panel showing `vtex-store: running`, then clicking the tools/search icon to reveal the MCP tool list.

**Cut plan:**

| Sub-beat | Time | What to show | Caption (English) |
|---|---|---|---|
| 1a | 0:10 – 0:18 | Claude Desktop opening, Settings → Developer revealed | **MCP server: `vtex-store` · live connection** |
| 1b | 0:18 – 0:28 | Click the tools icon, list of MCP tools visible (browseProducts, addToCart, checkoutInChat, executePayment, etc.) | **16 tools exposed — search · cart · checkout · AP2 payment. That's the entire trust surface.** |
| 1c | 0:28 – 0:35 | Crossfade to chat input, blinking cursor | *(no caption — let the visual breathe)* |

**Animation:** when the tool list appears, zoom in 1.2× to make text readable.

---

### Scene 2 — Shopping + checkout (0:35 – 1:35, from your 1:54 raw)

**What's in the raw footage:** type "caut pantaloni scurti", show VTEX IO adapter being called, add 2 items, search shirt, add, type "checkout", mandate badge appears, click Pay Now.

**Cut plan (aggressive: 1:54 → 1:00):**

| Sub-beat | Time | What to show | Caption |
|---|---|---|---|
| 2a | 0:35 – 0:43 | Type "caut pantaloni scurti" (in Romanian) | **User asks in Romanian: *"I'm looking for shorts"*** |
| 2b | 0:43 – 0:53 | Tool call `browseProducts` expands. **Cut to your "show VTEX IO adapter being called" beat** — what does this look like? If it's a log panel, zoom in on the tool name. | **MCP → VTEX IO adapter → live VTEX catalog + Pinecone vector index** |
| 2c | 0:53 – 1:03 | Product cards render. Add 1 shorts to cart. Then quick search "tricou", add. Then "cămașă", add. **Heavily speed up** loading + animation between adds (200% on dead frames). | **Real merchant · Real prices · Real RON** |
| 2d | 1:03 – 1:13 | Type "ce am in cos" → cart preview renders with 3 items + total | **Same `orderForm` a human would have shopping natively** |
| 2e | 1:13 – 1:25 | Type "checkout" → iframe opens showing AP2 Security panel (mandate ID, merchant DID, cart hash) | **Merchant signs CartMandate · `did:web:acg--miniprix.myvtex.com`**<br>**Ed25519 · JCS (RFC 8785) · published DID** |
| 2f | 1:25 – 1:35 | Click Pay Now → ceremony 4-step reveal plays | **Step 1: drift check. Step 2: CP signs. Step 3: Network verifies 7 properties. Step 4: receipt signed.** |

**Animation notes:**
- On 2b: if you have a log panel visible showing `[ACG Search] Request:` etc., zoom in 1.5× and highlight that line with a colored rectangle.
- On 2c: jump-cut between the 3 "add to cart" actions. Don't show the full add animation each time.
- On 2e: pause briefly (0.5s hold) when the mandate hash is visible in the badge. The hash text should be readable to the viewer.
- On 2f: don't speed up the 7-check reveal. It's the visual centerpiece.

---

### Scene 3 — Three signed artifacts (1:35 – 2:10, from your 0:47 raw)

**What's in the raw footage:** payment ceremony complete, opening CartMandate, PaymentMandate, PaymentReceipt JSON tabs.

**Cut plan (0:47 → 0:35):**

| Sub-beat | Time | What to show | Caption |
|---|---|---|---|
| 3a | 1:35 – 1:42 | Click CartMandate link → new tab opens with JSON. Highlight `merchant_authorization` JWT + `verification.valid: true` with a colored rectangle. | **CartMandate · signed by the merchant's private Ed25519 key**<br>**Verification: anyone fetches the public key from `/.well-known/did.json` and verifies the JWT.** |
| 3b | 1:42 – 1:50 | Click PaymentMandate link → highlight `user_authorization` JWT, `cp_did`, `payment_response.details.token` | **PaymentMandate · signed by the Credentials Provider**<br>**In production: Stripe · Adyen · PayPal · Apple Pay · Google Pay — the party holding the user's card-on-file.** |
| 3c | 1:50 – 1:58 | Click PaymentReceipt link → highlight `approval_status: "approved"`, all 7 `verification_checks: true`, `network_authorization` JWT | **PaymentReceipt · signed by the Payment Network**<br>**In production: Visa · Mastercard. Network is independent — sees only the cryptographic chain, not the user.** |
| 3d | 1:58 – 2:10 | Cut to 3 browser tabs side-by-side showing the three `.well-known/did.json` URLs. Three visibly different `publicKeyHex` values. | **3 private keys · 3 public keys · 3 different parties · zero shared trust** |

**Animation:**
- For each JSON view: speed up scrolling to 200%, but slow back to 100% (or pause for 0.5s) on the highlighted field.
- Use a strong colored highlight box around each key field — green border + semi-transparent fill — so it pops against the JSON.
- For 3d: a horizontal "wipe" transition between the three DID tabs works well. Or just split-screen them.

---

### Scene 4 — Force-reject ceremony (2:10 – 2:55, from your 1:37 raw)

**What's in the raw footage:** search rochie, add, check cart, double quantity, checkout, click "VTEX standard checkout" button first (you mentioned this), then force-reject, click receipt.

**Important framing decision:** you filmed BOTH a redirect-to-VTEX click AND a force-reject. For the video story, the force-reject is the punchline. The "VTEX standard checkout" click is interesting but eats time. Recommend cutting it entirely OR using it as a 2-3s "or use standard checkout — but here's the AP2 path" beat.

**Cut plan (1:37 → 0:45):**

| Sub-beat | Time | What to show | Caption |
|---|---|---|---|
| 4a | 2:10 – 2:18 | Search rochie, add one, brief cart view | **Different cart — same merchant. New transaction.** |
| 4b | 2:18 – 2:24 | Checkout → iframe with mandate. (Skip the "double quantity" beat unless you want to show drift — it'll confuse the rejection story.) | **What happens when the network rejects?** |
| 4c | 2:24 – 2:30 | Click the small `(force reject — staging only)` link | **Force-reject (staging only) — simulates insufficient funds / fraud flag / 3DS step-up failure** |
| 4d | 2:30 – 2:38 | Ceremony plays. **Step 3 reveals 6 ✓ + 1 ✗ on `payment_mandate_not_expired`.** Do NOT speed up this animation — the red checkmark is the moment. | **Network rejected the chain · 6 ✓ + 1 ✗** |
| 4e | 2:38 – 2:55 | Click PaymentReceipt link → JSON opens. **HIGHLIGHT BOTH `approval_status: "rejected"` AND `verification.valid: true` at the top level — visible at the same time.** | **THE PUNCHLINE** (2 lines, sequential):<br>**Payment rejected · the receipt itself is `verification.valid: true`.**<br>**The Network *signed the rejection*. Today's decline is a string. Tomorrow's is evidence.** |

**Music:** **drop volume to 0 (silence) under 4e.** The contradiction lands harder in silence. Bring music back at 2:55.

**This is the most important beat in the video.** Spend extra editing time here.

---

### Scene 5 — Widget surface (2:55 – 3:15, from your 2:09 raw)

**Hard truth:** you filmed 2 minutes of widget content but the runtime budget only has 20 seconds for this beat. Treat the widget as a B-roll proof that the same backend powers a second surface, not as a parallel ceremony to show in full.

**Cut plan (2:09 → 0:20):**

| Sub-beat | Time | What to show | Caption |
|---|---|---|---|
| 5a | 2:55 – 3:02 | Quick montage: widget chat with Romanian query → fusta cards rendering → user clicks one | **Storefront chat widget — same backend, different UI** |
| 5b | 3:02 – 3:08 | Mandate badge appearing with the green "Finalizează plata" button | **Same AP2 ceremony, in a React widget — sign mandate, click pay** |
| 5c | 3:08 – 3:15 | (Optional) brief flash of the ceremony playing in the widget, OR just hold on the cart preview | **Tomorrow: ChatGPT, UCP, autonomous agents — one engine.** |

**Heavy speedup recommended:** put Scene 5 footage at 250-300% speed. Viewer just needs to see "yes, the widget works too" — not the whole flow.

**Skip this scene entirely if you can't get it under 20s.** Move that time into the close.

---

### Scene 6 — Architecture + RAG (3:15 – 3:40, built in editor or screen recording)

**What to show:**

Option A (recommended): Screen-record yourself navigating to the case study page at `[your portfolio URL]/case-study/agent-commerce`, scrolling to the architecture diagram. ~25 seconds of slow pan over the diagram.

Option B: Export the architecture diagram from the case study page as a PNG and use it as a static image in the editor, with subtle pan-and-zoom (Ken Burns effect).

**Captions over the diagram:**

| Time | Caption |
|---|---|
| 3:15 – 3:22 | **Stack:** VTEX IO Adapter · Pinecone (semantic search) · OpenAI (embeddings) · Anthropic (chat loop) |
| 3:22 – 3:30 | **Three cryptographic identities — Merchant, CP, Network — each with its own `did:web`** |
| 3:30 – 3:40 | **Production swap-in: mock CP → Stripe/Adyen/PayPal · mock Network → Visa/Mastercard. Same orchestration code.** |

---

### Scene 7 — Compliance + CTA (3:40 – 4:00, built in editor)

**Built entirely in editor.** Plain dark background.

| Time | Visual | Caption |
|---|---|---|
| 3:40 – 3:48 | Text appears centered | **AP2 v0.2 spec-faithful**<br>**EdDSA Ed25519 · JCS (RFC 8785) · `did:web`**<br>**✓ Human-present shipped · IntentMandate (H-N-P) next** |
| 3:48 – 4:00 | URL + CTA prominent | **Want this on your store?**<br>**github.com/exilonX/ap2**<br>**[your-portfolio-url]/case-study/agent-commerce**<br>**Source under BSL 1.1 · Book a call to deploy** |

Hold the final frame for 1.5s, then fade to black at 4:00.

---

## Caption styling (apply consistently)

### Visual rules

- **Font:** sans-serif. **Inter** if available (free, modern, technical-feeling). Alternatives: SF Pro, Helvetica Neue, Roboto.
- **Body size:** 38-44 px at 1080p (rendered).
- **Hint / subtitle:** 24-28 px, lower opacity (~80%).
- **Color:** white text on a **dark semi-transparent bar** (rgba(0,0,0,0.65)) at lower-third. Or pure white with a thin black drop shadow (2px offset, 50% opacity) for clean look without the bar.
- **Position:** lower-third, ~80 px above the bottom edge. Never cover the iframe UI or JSON content.
- **Hold time:** ≥ 3 seconds per caption. Long captions ≥ 5 seconds. Reading speed is ~4 words/sec.
- **Transitions:** soft fade in 200ms, hold, fade out 300ms. No slides, no flashy effects.

### Technical fields

For caption text that includes technical fields like `did:web:...`, `cart_hash:`, `verification.valid: true`:

- **Use monospace font for the field** — Fira Code, JetBrains Mono, or Menlo. Inline within the sans-serif caption. About 28 px (slightly smaller than body).
- **Subtle background tint** — light gray bar (rgba(255,255,255,0.08)) around the monospace span.

This signals "this is a real technical field" without making the caption visually noisy.

### DaVinci Resolve specifics

- **Text+ effect** is the right tool — supports rich text, drop shadows, backgrounds.
- Create a **Text+ template** for the first caption, then duplicate it for each subsequent caption. Saves enormous time.
- Add captions on **V2 track** (V1 = footage). For long captions with subtitle/hint, use V2 for the body and V3 for the hint.

---

## Music + sound design

### Sourcing

Free / royalty-free options (in order of quality):

1. **YouTube Audio Library** — built into YT Studio, covers most needs. Free. Search "ambient", "tech", "minimal piano".
2. **Pixabay Music** — pixabay.com/music. Free, no attribution required. Good "tech ambient" selection.
3. **Free Music Archive (FMA)** — freemusicarchive.org. Free with various licenses.
4. **Epidemic Sound** — paid subscription (~$15/mo). Best quality for professional case studies. Try the free trial for the recording cycle.

### Recommended tracks for this video

Look for tracks with these qualities:
- **Instrumental only** — vocals fight with captions.
- **Slow tempo** — 60-90 BPM. Builds focus, not energy.
- **Sparse arrangement** — minimal piano, soft synth pads, light electronic.
- **Reference vibes:** Tycho, Floating Points, Boards of Canada, Nils Frahm, Olafur Arnalds.

**Specific search terms** that find the right vibe:
- *"minimal tech ambient"*
- *"slow piano electronic"*
- *"focus instrumental"*
- *"corporate calm"* (yes, it's a category — works for case studies)
- *"thoughtful piano"*

**Picks I'd start with** (Pixabay/YouTube Library, free):
- "Awakening" / "Stillness" / "Quiet Moments" — generic but works
- Anything labeled "minimal ambient piano" with a 80-100 BPM tempo

### Mixing levels

- **Music ducking** (Fairlight page in Resolve):
  - Base music level: **-18 dB**
  - Voice/dialogue level (if added): **-9 to -12 dB**
  - Use ducking with -6 dB attenuation under voice
- **Music cuts to silence under Scene 4e** (the rejection-receipt punchline). This is non-negotiable — the contradiction lands harder in silence.
- **Music fades out at 3:58**, leaves 2 seconds of silent CTA at end.

### Sound effects (optional, very lightly)

- **Soft "whoosh"** (–24 dB) on caption appearances. Use sparingly — only on Scene 0 title and major beats.
- **Subtle "click"** on artifact link opens in Scene 3 (~–20 dB).
- **No keyboard SFX, no chime SFX** — those read as low-budget on tech demos.

---

## Polish pass (after the rough cut is locked)

Before exporting:

- [ ] Watch the full cut 3 times in a row. Note every place your attention drifts.
- [ ] Each drift = a candidate for further cuts. Be brutal.
- [ ] Check captions for typos (one bad caption ruins credibility).
- [ ] Verify every technical field is correct (`did:web:` URLs spelled right, JSON field names exact).
- [ ] Audio levels: scrub through with headphones — no peaks above -6 dB.
- [ ] Cuts on the beat: if music has a tempo, align scene transitions to it.
- [ ] Final frame holds for 1.5s before fade.
- [ ] Render a 30s preview at the start (Deliver page → set range) and watch it on your phone — captions should be readable.

---

## Export settings (Deliver page)

For posting on portfolio + LinkedIn + X + HN:

- **Format:** MP4
- **Codec:** H.264
- **Resolution:** 1920×1080
- **Frame rate:** match timeline (30 or 60)
- **Quality:** Best (or "Restrict to" 12000 kbps for a ~30 MB file)
- **Audio:** AAC, 192 kbps, stereo

**Filename suggestion:** `agent-commerce-ap2-v1.mp4` — versioning lets you keep iterations.

For a second version optimized for embeds (smaller file):
- Same as above but **6000 kbps** for ~18 MB file.

---

## Pre-publish checklist

- [ ] 4:00 runtime hit (within 5 seconds)
- [ ] No dead frames > 1 second
- [ ] All captions readable on mobile (test on phone)
- [ ] All technical fields correct
- [ ] Force-reject scene punchline lands (silence under the receipt JSON reveal)
- [ ] Portfolio URL + repo URL correct in final card
- [ ] Watermark / logo if you want one (subtle, top-right, ~50% opacity)
- [ ] Export 2 versions: HQ (12 Mbps) for portfolio embed, LQ (6 Mbps) for social fallback

---

## Caption script — copy/paste for the editor

The full caption track in order, ready to drop into Text+ effects:

```
0:02   Agent Commerce on AP2
       An implementation of Google's Agent Payments Protocol
       Signed and verifiable. Built in 4 weeks.

0:10   MCP server: vtex-store · live connection

0:18   16 tools exposed — search · cart · checkout · AP2 payment.
       That's the entire trust surface.

0:35   User asks in Romanian: "I'm looking for shorts"

0:43   MCP → VTEX IO adapter → live VTEX catalog + Pinecone vector index

0:53   Real merchant · Real prices · Real RON

1:03   Same orderForm a human would have shopping natively

1:13   Merchant signs CartMandate · did:web:acg--miniprix.myvtex.com
       Ed25519 · JCS (RFC 8785) · published DID

1:25   Step 1: drift check
       Step 2: CP signs
       Step 3: Network verifies 7 properties
       Step 4: receipt signed

1:35   CartMandate · signed by the merchant's private Ed25519 key
       Verification: anyone fetches the public key from /.well-known/did.json
       and verifies the JWT.

1:42   PaymentMandate · signed by the Credentials Provider
       In production: Stripe · Adyen · PayPal · Apple Pay · Google Pay
       — the party holding the user's card-on-file.

1:50   PaymentReceipt · signed by the Payment Network
       In production: Visa · Mastercard.
       Network is independent — sees only the cryptographic chain, not the user.

1:58   3 private keys · 3 public keys · 3 different parties · zero shared trust

2:10   Different cart — same merchant. New transaction.

2:18   What happens when the network rejects?

2:24   Force-reject (staging only) — simulates insufficient funds /
       fraud flag / 3DS step-up failure

2:30   Network rejected the chain · 6 ✓ + 1 ✗

2:38   Payment rejected · the receipt itself is verification.valid: true.

2:43   The Network signed the rejection.
       Today's decline is a string. Tomorrow's is evidence.

2:55   Storefront chat widget — same backend, different UI

3:02   Same AP2 ceremony, in a React widget — sign mandate, click pay

3:08   Tomorrow: ChatGPT, UCP, autonomous agents — one engine.

3:15   Stack: VTEX IO Adapter · Pinecone (semantic search) ·
       OpenAI (embeddings) · Anthropic (chat loop)

3:22   Three cryptographic identities — Merchant, CP, Network —
       each with its own did:web

3:30   Production swap-in: mock CP → Stripe/Adyen/PayPal ·
       mock Network → Visa/Mastercard.
       Same orchestration code.

3:40   AP2 v0.2 spec-faithful
       EdDSA Ed25519 · JCS (RFC 8785) · did:web
       ✓ Human-present shipped · IntentMandate (H-N-P) next

3:48   Want this on your store?
       github.com/exilonX/ap2
       [your-portfolio-url]/case-study/agent-commerce
       Source under BSL 1.1 · Book a call to deploy
```

---

## "I'm stuck" / common edit problems

- **Caption text wraps awkwardly:** shorten. Two short captions in sequence read better than one long wrap.
- **Footage feels slow:** speed up to 150% on action gaps, 300% on JSON scrolls.
- **Footage feels rushed:** lengthen the 7-check reveal in 2f and 4d (slow to 85% if needed). The punchline beats need breathing room.
- **Music sounds amateur:** instrumental + slow. If it has drums, it's too energetic for this demo.
- **Captions feel cluttered:** drop the secondary/hint line. The voice is the punchline; the caption reinforces.
- **JSON unreadable on small screens:** zoom 1.5× and highlight only the key field with a colored rectangle. Don't show 50 lines of JSON.

---

## After publishing

The video is the hook. The case study page (already at your portfolio's `/case-study/agent-commerce`) is the conversion. The CTA on the video points to either the case study page or directly to a contact form / Calendly.

Track:
- View completion rate (proxy for "did the punchline land?")
- Click-throughs from video → case study page
- Click-throughs from case study → contact form

If the video drops viewers before 2:55 (the rejection punchline), the early scenes are too long. If it drops between 3:00 – 3:30 (architecture diagram), the diagram is too dense. Tune in v2.
