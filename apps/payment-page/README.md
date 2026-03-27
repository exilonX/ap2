# Payment Page

**Status:** Demo Phase (Embedded in VTEX IO for now)
**Purpose:** Simple checkout UI where user confirms and pays

## What This Does

When Claude says "Here's your checkout link," this is where the user lands.

For the demo, this is just an HTML page served by the VTEX IO adapter. No separate app needed.

## Demo Scope

A single HTML page that:
1. Shows order summary (items, prices, total)
2. Has a "Pay" button
3. On click, calls the execute endpoint
4. Shows confirmation or error

**No Google Pay integration for demo** - just a simple button that triggers a test payment.

## Current Implementation

Lives inside VTEX IO adapter at:
```
GET /_v/acg/checkout/pay/{sessionId}
```

Returns server-rendered HTML (see `vtex-io-adapter/node/handlers/checkout.ts`).

## Future (Production)

When this needs to be a real payment page:

### Option A: Keep in VTEX IO
- Add Google Pay SDK
- Handle real payment tokens
- More complex but fewer moving parts

### Option B: Separate React/Next.js App
- Better UX flexibility
- Can be branded per merchant
- Hosted separately (Vercel, etc.)

### What the Production Page Needs

1. **Mandate Display**
   - Show what user is authorizing
   - Display merchant identity (DID)
   - Show expiration

2. **Google Pay / Apple Pay Integration**
   - Real payment buttons
   - Handle payment token generation
   - Pass token back to ACG

3. **3DS2 Challenge Handling**
   - Embed challenge iframe if needed
   - Handle redirect flows
   - Return to confirmation

4. **Security**
   - HTTPS only
   - CSRF protection
   - Session validation

## Files Structure (Future - If Separated)

```
/payment-page
├── src/
│   ├── pages/
│   │   └── pay/[sessionId].tsx
│   ├── components/
│   │   ├── OrderSummary.tsx
│   │   ├── PaymentButton.tsx
│   │   └── Confirmation.tsx
│   └── lib/
│       └── api.ts
├── public/
├── package.json
└── next.config.js
```

## Next Steps (Demo)

1. [x] Basic HTML in VTEX IO handler (current approach)
2. [ ] Style it nicely
3. [ ] Add loading states
4. [ ] Add error handling UI

## Next Steps (Production)

1. [ ] Decide: Keep in VTEX IO or separate app?
2. [ ] Integrate Google Pay SDK
3. [ ] Add mandate display section
4. [ ] Implement 3DS2 flow
5. [ ] Add proper styling/branding
