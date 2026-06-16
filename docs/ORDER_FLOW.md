# Order Creation Flow — End-to-End

What actually happens when the agent creates a VTEX order via ACG.

## High-level state machine

```
┌───────────────┐
│ widget /      │
│ Claude Desktop│
└──────┬────────┘
       │ JSON over HTTPS / stdio MCP
       ▼
┌───────────────────────────────────────────────────┐
│  acg-adapter (VTEX IO)                            │
│  ─────────────────────                            │
│                                                   │
│   ① create cart        ──► OrderForm:CREATED      │
│            │                                      │
│            ▼                                      │
│   ② add items          ──► OrderForm:HAS_ITEMS    │
│            │                                      │
│            ▼                                      │
│   ③ set profile        ──► OrderForm:HAS_PROFILE  │
│            │                                      │
│            ▼                                      │
│   ④ set shipping       ──► OrderForm:HAS_SHIPPING │
│            │                                      │
│            ▼                                      │
│   ⑤ list payment       ──► reads paymentSystems   │
│       methods                                     │
│            │                                      │
│            ▼                                      │
│   ⑥ set payment        ──► OrderForm:HAS_PAYMENT  │
│       method               (+ buyer identity      │
│                              on payment object)   │
│            │                                      │
│            ▼                                      │
│   ⑦ place_order        ┌─► sign CartMandate (AP2) │
│            │           │   (JCS + Ed25519)        │
│            │           ├─► persist to VBase       │
│            │           └─► POST /transaction      │
│            │                                      │
│            ▼              Transaction:OPEN        │
│   ⑧ send_payment_info  ──► Gateway:HAS_PAYMENT    │
│            │              (kicks Cash → settle)   │
│            ▼                                      │
│   ⑨ authorize_         ┌─► PRIMARY: /pvt/         │
│       transaction      │     authorization-request│
│                        │   (status 8 = approved   │
│                        │    awaiting settlement)  │
│                        │                          │
│                        └─► FALLBACK: gatewayCb    │
│                              (only in browser     │
│                               context, fails in   │
│                               IO with CHK003)     │
│                                                   │
│                            Order:APROBATĂ         │
└───────────────────────────────────────────────────┘
```

## Step-by-step API map

Step ② through ⑥ talk to **VTEX Checkout API** (`vtexcommercestable.com.br`).
Step ⑦ split: Checkout API for `/transaction`, VBase for mandate persistence.
Step ⑧/⑨ talk to **VTEX Payments Gateway** (`vtexpayments.com.br`) using the
merchant's AppKey/AppToken (set in app settings as `vtexAppKey` /
`vtexAppToken`).

| # | Agent tool | Backend route | VTEX endpoint | Auth | Notes |
|---|---|---|---|---|---|
| ① | `getCart` (implicit) | `GET /_v/acg/cart` | `POST /api/checkout/pub/orderForm` | IO proxy-auth | Creates an empty orderForm and returns its id |
| ② | `add_to_cart` | `POST /_v/acg/cart/items` | `POST /api/checkout/pub/orderForm/:id/items` | IO proxy-auth | Body: `{orderItems:[{id,quantity,seller}]}` |
| ③ | `set_customer_profile` | `POST /_v/acg/cart/profile` | `POST /api/checkout/pub/orderForm/:id/attachments/clientProfileData` | IO proxy-auth | `phone` normalized to RO local 10-digit; `documentType` defaults `"document"`. Avoid emails in customer DB (CHK0087) |
| ④ | `set_shipping_address` | `POST /_v/acg/cart/shipping` | `POST /api/checkout/pub/orderForm/:id/attachments/shippingData` | IO proxy-auth | `receiverName` defaults to `firstName + lastName`; `neighborhood` omitted when undefined |
| ⑤ | `list_payment_methods` | `POST /_v/acg/checkout/list-payment-methods` | `GET /api/checkout/pub/orderForm/:id` | IO proxy-auth | Reads `paymentData.paymentSystems[]` |
| ⑥ | `set_payment_method` | `POST /_v/acg/checkout/set-payment-method` | `POST /api/checkout/pub/orderForm/:id/attachments/paymentData` | IO proxy-auth | Includes `firstName/lastName/document/documentType` on the payment object so the PCI Gateway widget can render buyer identity |
| ⑦ | `place_order` | `POST /_v/acg/checkout/place-order` | `POST /api/checkout/pub/orderForm/:id/transaction` | IO proxy-auth | Signs CartMandate (JCS + Ed25519) + persists to VBase before POST. Returns `transactionId`, `orderGroup`. **Starts the 5-minute window.** |
| ⑧ | `send_payment_info` | `POST /_v/acg/checkout/send-payment-info` | `POST /api/pub/transactions/:tid/payments?orderId=:og` | IO proxy-auth | Bare-array body. `fields:{}` empty for Cash/promissory; card data goes here for direct card capture |
| ⑨ | `authorize_transaction` | `POST /_v/acg/checkout/authorize` | `POST /api/pvt/transactions/:tid/authorization-request` *(or fallback `POST /api/checkout/pub/gatewayCallback/:orderGroup`)* | **AppKey/AppToken** | Primary path uses Payments Gateway credentials. Status 8 = "approved, awaiting automatic settlement" (Cash). Fallback only runs if `/pvt/` throws non-1403 |

## Where things live

- Agent tools — [packages/vtex-io-adapter/node/agent-tools/](../packages/vtex-io-adapter/node/agent-tools/)
- Route handlers — [packages/vtex-io-adapter/node/handlers/headless-checkout.ts](../packages/vtex-io-adapter/node/handlers/headless-checkout.ts)
- HTTP clients — [packages/vtex-io-adapter/node/clients/checkout.ts](../packages/vtex-io-adapter/node/clients/checkout.ts)
- MCP proxy tools — [packages/mcp-server/src/tools/headless-checkout.ts](../packages/mcp-server/src/tools/headless-checkout.ts)
- AP2 mandate signing — [packages/core/src/mandates.ts](../packages/core/src/mandates.ts)
- VBase state seam — [packages/vtex-io-adapter/node/mandates/mandate-orchestration.ts](../packages/vtex-io-adapter/node/mandates/mandate-orchestration.ts)
- Standalone probe (ground truth) — [scripts/vtex-headless-probe/run.ts](../scripts/vtex-headless-probe/run.ts)

## State carried between steps

Two seams keep the chain stitched together across stateless calls:

1. **`orderFormId`** — captured by `getOrCreateOrderForm` (`node/utils/session.ts`).
   - MCP path: header `X-ACG-Order-Form-Id` round-tripped by `VtexClient`
   - Widget path: same-domain cookie

2. **`acg-orderform-state` VBase bucket** — per-orderFormId record:
   ```json
   {
     "cartMandateId": "mandate-...",
     "didDocumentUrl": "https://.../did.json",
     "signedAt": "ISO-8601",
     "transactionId": "...",   // step ⑦ writes
     "orderGroup": "...",      // step ⑦ writes
     "merchantName": "..."     // step ⑦ writes (from /transaction response)
   }
   ```
   Steps ⑧ and ⑨ read it to rediscover the in-flight transaction.

3. **`acg-order-mandate-index` VBase bucket** — per-orderGroup mandate ref,
   the seam a future PPP payment connector reads during its `authorize`
   callback (the connector only knows `orderId`/`orderGroup`, not
   `orderFormId`):
   ```json
   {
     "cartMandateId": "mandate-...",
     "didDocumentUrl": "https://.../did.json",
     "signedAt": "ISO-8601",
     "signedBy": "did:web:acg--...",  // present when place_order auto-signed
     "transactionId": "..."
   }
   ```
   Written at the end of step ⑦. Public lookup via
   `GET /_v/acg/mandates/by-order/:orderGroup` returns `{orderGroup, ref,
   mandateUrl, didDocumentUrl}` — connector follows `mandateUrl` to
   `/mandates/:cartMandateId` for the signed EvidenceBundle and verifies
   Ed25519 against `didDocumentUrl`.

   Why this bucket, NOT `orderForm.customData.ap2` or `Order.customData`:
   VTEX's `customData` namespace requires the `appId` to be pre-registered
   as a custom app in the merchant's checkout-UI config, and the only
   documented write is per-single-field; whole-namespace PUT returns 404.
   VBase needs no registration and gives atomic read/write of the whole
   record, with the same merchant-key ACL as the mandate registry itself.

## Settlement states (per gateway response status)

`auth.status` returned by `/pvt/authorization-request` can be string OR number:

| Status | Category | What it means |
|---|---|---|
| `"approved"`, `"completed"`, `"success"` | approved | Card direct, fully settled |
| `1`, `2` | approved | Authorized variants |
| `8` | approved | **Cash/promissory** — "decontare automată programată" |
| `"pending"`, `"undefined"`, `"authorize"` | pending | Redirect methods, async settlement |
| `0`, `5`, `6`, `7` | pending | Numeric authorize/awaiting states |
| `"denied"`, `"cancelled"` | denied | Hard reject |
| `3`, `4` | denied | Numeric reject codes |

If `/pvt/` throws **400 with VTEX error code 1403** ("Authorization is pending"),
treat as approved — the gateway already has the payment in flight (typical for
Cash after `send_payment_info`).

## What the admin shows when this works

- **OMS** ([admin/orders/{orderGroup}-01]) — status "În procesare" → "Aprobată"
- **PCI Gateway transaction** — bandă verde **APROBATĂ**, "Decontare automată programată..." footer (Cash)
- **AP2 mandate** retrievable at `GET /_v/acg/mandates/{cartMandateId}`
- **PPP connector lookup** via `GET /_v/acg/mandates/by-order/{orderGroup}` returns the same `cartMandateId` plus the merchant DID URL for independent verification

## Known sharp edges

### `CHK0087` "Este necesară autentificarea pentru utilizarea unei noi adrese"
Triggered when the email passed in step ③ exists in the merchant's customer DB.
VTEX refuses to let a guest session associate a new shipping address with an
existing customer. Use a guest email (e.g. `demo@test.ro`) or authenticate the
session before step ③.

### `CHK003` "Acces interzis" on `gatewayCallback`
The `gatewayCallback` endpoint expects browser session cookies
(`CheckoutOrderFormOwnership`, `checkout.vtex.com`). In server-to-server IO
context, we don't have them. The primary `/pvt/authorization-request` with
AppKey/AppToken bypasses this.

### `1403` "Authorization is pending for payments with Ids = ..."
Returned by `/pvt/authorization-request` when the gateway has already started
authorizing (typically because `send_payment_info` kicked it). Treated as
approved (terminal success) in the agent tool.

### Cash: status `8` + APROBATĂ + `Fără denumire` on payment widget
The order is approved, but the PCI Gateway transaction widget renders
"Fără denumire" instead of the buyer name. Current hypothesis: VTEX reads
buyer identity from `paymentData.payments[].firstName/lastName/document/
documentType` — set in `Cart.setPaymentData`. **Not yet confirmed by live
test.** If the badge still reads "Fără denumire" after deploy, see TODO 02.

## Reference docs

- VTEX official 3-step flow: <https://developers.vtex.com/docs/guides/creating-a-regular-order-from-an-existing-cart>
- Checkout API: <https://developers.vtex.com/docs/api-reference/checkout-api>
- Payments Gateway API: <https://developers.vtex.com/docs/api-reference/payments-gateway-api>
- Local skill: [`.agents/skills/headless-checkout-proxy/SKILL.md`](../.agents/skills/headless-checkout-proxy/SKILL.md)
- Postman ground truth: [`docs/ACG-VTEX-APIs.postman_collection.json`](./ACG-VTEX-APIs.postman_collection.json)
