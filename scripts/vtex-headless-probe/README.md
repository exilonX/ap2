# vtex-headless-probe

Standalone Node script that drives the **full VTEX headless checkout flow** end-to-end against a live merchant account, **without** going through VTEX IO, MCP, the chat-widget, or any other layer of our stack.

It exists for one reason: when the adapter is stuck in an error loop (parsing → ORD009 → 401 → parsing → …), this script becomes the ground-truth oracle. We fix things here first — where the round-trip is `npm run probe` instead of `vtex link` — then port the corrections back to `packages/vtex-io-adapter`.

## What it does (9 steps, the Postman collection)

1. `POST /api/checkout/pub/orderForm` — create cart
2. `POST /api/checkout/pub/orderForm/:id/items` — add item
3. `POST /api/checkout/pub/orderForm/:id/attachments/clientProfileData` — set profile
4. `POST /api/checkout/pub/orderForm/:id/attachments/shippingData` — set address + SLA
5. `GET  /api/checkout/pub/orderForm/:id` — read payment methods
6. `POST /api/checkout/pub/orderForm/:id/attachments/paymentData` — pick a method
7. `POST /api/checkout/pub/orderForm/:id/transaction` — create transaction (→ orderGroup, transactionId)
8. `POST {account}.vtexpayments.com.br/api/pub/transactions/:tid/payments?orderId=:og` — gateway
9. `POST {account}.vtexpayments.com.br/api/pvt/transactions/:tid/authorization-request` — authorize

Every step logs the full request body + response. The script aborts at the first non-2xx response, printing the request URL, body, response status, and body, so we know exactly which step needs work and what VTEX actually returned.

## Running it

```bash
cd scripts/vtex-headless-probe
npm install
cp .env.example .env       # then fill in
npm run probe
```

The minimum required env is `VTEX_ACCOUNT`, `SKU`, `EMAIL`. Step 9 (authorize) additionally needs `VTEX_APP_KEY` + `VTEX_APP_TOKEN` because the `/pvt/` endpoint requires merchant credentials. Without them, the script stops cleanly after step 8 and prints the orderGroup so you can verify the order in admin.

`PAYMENT_SYSTEM_ID` defaults to `47` (Cash); override for card/redirect methods.

`POSTAL_CODE`, `CITY`, etc. override the default shipping address. The defaults target a Bucharest address that resolves to a real SLA on `vtexeurope`.

## Output

The script writes a structured trace to `./traces/<timestamp>.json` so you can grep through it later. The console output is human-readable; the trace is grep/jq-friendly.

## When this script becomes stale

It mirrors what `packages/vtex-io-adapter/node/agent-tools/{create-cart-mandate,list-payment-methods,set-payment-method,place-order,send-payment-info,authorize-transaction}.ts` do at the network level. When those drift, update this script too — otherwise the oracle drifts off the real flow.
