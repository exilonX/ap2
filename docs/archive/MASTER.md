Here is a comprehensive master document for your repository. You can save this as `DESIGN.md` or `ROADMAP.md` in your root folder.

It effectively merges your detailed technical knowledge of VTEX with the strategic "Universal Middleware" approach we discussed. It serves as both your architectural blueprint and your project management tracker.

***

# Agent Commerce Gateway (ACG) - Project Master Plan

**Status:** Draft / In-Progress
**Target:** MVP Showcase (VTEX Implementation)
**Core Concept:** A middleware layer enabling AI Agents (LLMs) to securely discover products, negotiate carts, and execute payments using the **Agent Payments Protocol (AP2)** standards.

---

## 1. High-Level Architecture
Instead of building this logic inside a proprietary platform (like a VTEX IO app), this project is built as a standalone **Node.js Gateway**. This ensures ownership of the IP and reusability for other platforms (Shopify, Magento, etc.) in the future.

### The "Sandwich" Model
1.  **Top Layer (The Interface): MCP Server**
    *   Exposes a standardized set of tools to the AI (Claude/Gemini/OpenAI).
    *   *Protocol:* Model Context Protocol (MCP).
    *   *Responsibility:* Translating "Human/AI Intent" into structured API calls.

2.  **Middle Layer (The Core - "The Brain"):**
    *   **AP2 Protocol Engine:** Handles Cryptography, Mandates, Signing, and JCS (JSON Canonicalization).
    *   **State Machine:** Manages the flow from `Cart` -> `CartMandate` -> `PaymentMandate` -> `Order`.
    *   **Identity:** Manages the Merchant DID (Decentralized Identifier) and signing keys.

3.  **Bottom Layer (The Adapters):**
    *   **VTEX Adapter (MVP Focus):** Translates generic commands into VTEX REST/GraphQL calls.
    *   *Future Adapters:* Shopify, Checkout.com, Stripe.

---

## 2. Technical Stack
*   **Runtime:** Node.js (TypeScript).
*   **Framework:** Fastify (low overhead) or Express.
*   **AI Interface:** `@modelcontextprotocol/sdk`.
*   **Cryptography:** `canonicalize` (RFC 8785 compliance), `jose` (JWS/JWE handling).
*   **Data Validation:** Zod (for validating schemas coming from LLMs).
*   **Storage (MVP):** Redis (for session/nonce storage) or In-Memory Map (for initial prototype).

---

## 3. Core Functional Flows (The "VTEX" Implementation)

### A. Discovery & Cart Building (Human Present)
The goal is to prevent token overload. The MCP Server transforms heavy VTEX `orderForm` JSON into lightweight `SimpleProduct` schemas.

*   **Action:** `searchProducts(query)` -> Calls VTEX Search API -> Returns simplified JSON.
*   **Action:** `addToCart(sku, quantity)` -> Calls VTEX `orderForm` (add item).
*   **Action:** `getCart()` -> Returns current total, shipping estimate, and items.

### B. The Mandate Flow (AP2 Standard)
This is the security layer. The Agent cannot "just buy." It must get a cryptographic "OK".

1.  **Proposal:** Agent requests `createCartMandate()`.
2.  **Locking:** System calls VTEX `PlaceOrder` (or locks cart via attachment) to freeze prices.
3.  **Canonicalization:** System strips the cart to essential fields (Line Items + Total + Currency) and applies **RFC 8785**.
4.  **Signing:** System signs the canonical JSON with the Merchant Private Key.
5.  **Output:** Returns `CartMandate` (The JSON + The Signature + Expiry).

### C. Execution (The Payment)
*   **Input:** Agent provides a `PaymentMandate` containing a **Google Pay Token** (obtained from user via UI/Mock).
*   **Validation:** System verifies:
    *   Is the Cart Mandate signature valid?
    *   Has the price changed in VTEX?
    *   Is the Google Pay token valid?
*   **Execution:** System calls VTEX Payment Gateway (using the Google Pay token).
*   **3DS2 Handling:** If VTEX returns a Redirect/Challenge, the system pauses and returns a `verification_url` to the Agent.

---

## 4. Implementation Roadmap (4-Week Sprint)

### Week 1: The Headless Core & MCP
**Goal:** Conversational Commerce (Read/Write without Payment).
*   [ ] Initialize Node.js TypeScript repo.
*   [ ] Implement **MCP Server** (stdio transport).
*   [ ] Build **VTEX Adapter**:
    *   `searchProducts` (Search API).
    *   `createCart` / `addToCart` (OrderForm API).
    *   **Crucial:** Implement the `DataMapper` to convert VTEX JSON -> Standard Schema.
*   **Deliverable:** You can ask Claude Desktop: *"Find me running shoes on my VTEX store and put them in a cart"* and it works.

### Week 2: The Cryptography Layer (AP2)
**Goal:** Generating the Trust Artifacts.
*   [ ] Implement **DID Management**:
    *   Generate Keypair (Ed25519 or ES256).
    *   Serve `/.well-known/did.json` endpoint.
*   [ ] Implement **JCS (JSON Canonicalization Scheme)**.
*   [ ] Create `createCartMandate` endpoint:
    *   Takes current VTEX `orderForm`.
    *   Generates the Hash/Signature.
    *   Stores the "Mandate" state in memory/Redis.
*   **Deliverable:** A log output showing a cryptographically signed JSON object representing a VTEX cart.

### Week 3: Payment Execution & Google Pay Mock
**Goal:** Completing the loop.
*   [ ] Create **Payment Executor**:
    *   Accept `executePayment(paymentToken, mandateHash)`.
    *   Verify Hash matches the stored Mandate.
*   [ ] Implement **VTEX Order Placement**:
    *   Finalize `transaction` in VTEX using the mock/test token.
*   [ ] **The Hack:** Create a simple script to simulate the "Shopper Agent" generating a dummy Google Pay token to test the flow without a full frontend.
*   **Deliverable:** An order appears in VTEX Admin created purely via API.

### Week 4: Polish & The Showcase
**Goal:** The Portfolio Piece.
*   [ ] Error Handling: Graceful failures (e.g., "Product out of stock").
*   [ ] **Demo Recording:**
    *   Split screen: AI Chat vs. VTEX Admin.
    *   Scenario: Negotiation -> Mandate -> Payment -> Order Success.
*   [ ] Documentation: Write the integration guide for a generic VTEX store.

---

## 5. Repository Structure (Suggested)

```text
/agent-commerce-gateway
├── /src
│   ├── /core
│   │   ├── mcp-server.ts       # The AI Interface logic
│   │   ├── crypto.ts           # JCS, Signing, Hashing (AP2 logic)
│   │   ├── mandate-manager.ts  # State machine for mandates
│   │   └── types.ts            # Standard Domain Models (Product, Cart)
│   ├── /adapters
│   │   ├── /vtex
│   │   │   ├── client.ts       # Axios instance for VTEX API
│   │   │   ├── mapper.ts       # Transforms VTEX JSON <-> Standard Model
│   │   │   └── index.ts        # The Adapter Interface implementation
│   │   └── /shopify            # (Placeholder for future)
│   ├── /config                 # Env vars (VTEX Keys, Merchant Private Keys)
│   └── server.ts               # Fastify/Express Entry point
├── /tests
│   ├── ap2-signing.test.ts     # Verify canonicalization is byte-perfect
│   └── vtex-flow.test.ts
├── Dockerfile
├── package.json
└── README.md
```

---

## 6. Key Considerations for VTEX
*   **Token Heaviness:** Always filter VTEX API responses. LLMs have context limits. Never send the full `orderForm`.
*   **Price Drift:** VTEX prices can change based on shipping address. Ensure `createCartMandate` happens *after* shipping is calculated.
*   **Audit:** Log every `MandateHash` generated. This is your proof of contract if a dispute happens.

---

## 7. Future Expansion (Post-MVP)
1.  **Agent Discovery:** Register the `did:web` in a global registry so agents can "find" the store automatically.
2.  **Human-Not-Present:** Implement `IntentMandate` (Allowing the AI to spend $50/week on coffee without asking).
3.  **Audit Dashboard:** A simple UI to view signed Mandates.