# `payment-page` — placeholder

The checkout / payment UI for ACG is currently **served by the VTEX IO adapter** at:

```
GET /_v/acg/checkout/pay/{sessionId}
```

Source: [`packages/vtex-io-adapter/node/handlers/checkout.ts`](../../packages/vtex-io-adapter/node/handlers/checkout.ts).

This directory exists as a placeholder for a future standalone checkout app (separate React/Next.js, brandable per merchant, Google Pay / Apple Pay SDKs, 3DS2 step-up). Not part of the public release.

See the [repository root README](../../README.md) for the live AP2 checkout flow.
