# Core - AP2 Protocol Engine

**Status:** Future (Post-Demo)
**Purpose:** Reusable AP2 protocol implementation - the cryptographic brain

## What This Will Do

This package implements the AP2 (Agent Payments Protocol) standards:
- DID (Decentralized Identifier) management
- JSON Canonicalization (RFC 8785)
- Mandate creation and signing
- Signature verification

This is your **reusable IP** - it knows nothing about VTEX, Shopify, or any platform. It only knows about "carts," "mandates," and "signatures."

## Why It's Separate

By keeping AP2 logic in its own package:
- Can be used by any adapter (VTEX, Shopify, custom)
- Easier to test cryptographic code in isolation
- Clear separation between "protocol" and "platform"
- This is what you can license/sell independently

## Demo Scope

**Not needed for demo.** The demo works without real AP2 compliance.

For the demo, we skip this and just:
- Log what a mandate "would" contain
- Show the concept in the payment page
- Explain it in the demo video

## Post-Demo Implementation

### DID Management (`src/ap2/did.ts`)

```typescript
// Generate merchant identity
generateKeyPair(): { publicKey: string, privateKey: string }

// Serve at /.well-known/did.json
getDIDDocument(): DIDDocument

// Verify another party's DID
verifyDID(did: string): Promise<boolean>
```

### JSON Canonicalization (`src/ap2/jcs.ts`)

```typescript
// RFC 8785 - deterministic JSON serialization
canonicalize(json: object): string

// Hash the canonical form
hash(canonical: string): string  // SHA-256
```

### Mandate Management (`src/ap2/mandates.ts`)

```typescript
// Create a Cart Mandate
createCartMandate(cart: Cart, payerDID: string, merchantKeys: KeyPair): CartMandate

// Create a Payment Mandate
createPaymentMandate(cartMandate: CartMandate, paymentData: PaymentData): PaymentMandate

// Verify a mandate signature
verifyMandate(mandate: Mandate, publicKey: string): boolean
```

## Files Structure (Future)

```
/core
├── src/
│   ├── ap2/
│   │   ├── did.ts          # DID generation and management
│   │   ├── jcs.ts          # JSON Canonicalization (RFC 8785)
│   │   ├── signing.ts      # Signature creation/verification
│   │   └── mandates.ts     # Mandate creation logic
│   ├── types/
│   │   ├── mandate.ts      # CartMandate, PaymentMandate, IntentMandate
│   │   ├── cart.ts         # Platform-agnostic cart types
│   │   └── identity.ts     # DID, KeyPair types
│   └── index.ts            # Public exports
├── package.json
└── tsconfig.json
```

## Dependencies (Future)

```json
{
  "dependencies": {
    "canonicalize": "^2.0.0",    // RFC 8785
    "jose": "^5.0.0",            // JWS/JWE handling
    "@noble/ed25519": "^2.0.0"   // Ed25519 signatures
  }
}
```

## Next Steps (Post-Demo)

1. [ ] Research AP2 spec in detail (types, flows)
2. [ ] Implement JCS canonicalization
3. [ ] Implement Ed25519 key generation
4. [ ] Implement DID document structure
5. [ ] Implement CartMandate creation
6. [ ] Write comprehensive tests
7. [ ] Integrate into VTEX IO adapter
