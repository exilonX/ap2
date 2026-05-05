## 0002 — Cart module (Cart Negotiation made concrete)

- **Status:** ready-for-agent
- **Created:** 2026-05-05
- **Last updated:** 2026-05-05 (grilling complete)
- **GitHub:** _(filled when promoted)_
- **Priority:** P0 (foundation for Issue 01 and the chat tool surface)
- **Demo-blocking:** Yes

### Context

Cart Negotiation is named as a sub-domain in `CONTEXT.md`, but it isn't a real module — it's a smear. Both the REST cart handlers and the chat tool executor reach into `ctx.clients.checkout.getOrderForm`, then do `orderForm.items.findIndex(...)`, `cart.items.find(...)`, etc. The shape of an external VTEX type leaks across the whole Adapter. Cross-cutting rules are unevenly distributed (discovered during grilling — the chat tool has earned scar tissue the REST handlers don't have):

| Rule | REST handler | Chat tool |
|---|---|---|
| Fabricated-SKU rejection (`588600_M`) | Missing | Present |
| ORD003 transient retry | Missing | Present (350 ms back-off) |
| Actually-added check (qty before/after) | Missing | Present |
| Coupon-actually-applied check | Half — different message | Half — trusts result |
| Item-index lookup-by-SKU | Duplicated literally | Duplicated literally |

The longer this drifts, the more two-and-a-half implementations we get. A `CartMandate` (Issue 01) is signed over **cart contents** — until there's a stable Cart shape that hides orderForm and enforces these rules uniformly, mandate signing rests on whatever shape happened to be assembled at the call site.

### Acceptance

#### A. The `Cart` module — class with explicit deps

Lives in `node/cart/cart.ts`. Constructor signature is the full dependency contract; no implicit coupling to `ctx`:

```ts
export interface CartDeps {
  checkout: CheckoutClient   // existing — node/clients/checkout.ts
  log?: Logger
}

export class Cart {
  constructor(private deps: CartDeps) {}
  // ... operations below
}
```

Instantiated once per request inside the handler/chat-tool layer:

```ts
const cart = new Cart({ checkout: ctx.clients.checkout })
```

`Cart` is **not** registered in the `IOClients` pattern (`ctx.clients.cart`) — `IOClients` is reserved for HTTP/external clients with retry/cache config. `Cart` is a domain module that *uses* an HTTP client; mixing the two muddies the layering.

#### B. Public operations (9 total)

```ts
addItem(orderFormId, sku, qty)              → Promise<SimpleCart>
removeBySku(orderFormId, sku)               → Promise<SimpleCart>
setQuantity(orderFormId, sku, qty)          → Promise<SimpleCart>
getCart(orderFormId)                        → Promise<SimpleCart>
applyCoupon(orderFormId, code)              → Promise<{ cart: SimpleCart; applied: boolean; reason?: string }>
setCustomerProfile(orderFormId, data)       → Promise<SimpleCart>
setShippingAddress(orderFormId, data)       → Promise<SimpleCart>
getShippingOptions(orderFormId)             → Promise<ShippingOption[]>
createCart()                                → Promise<SimpleCart>
```

`getShippingOptions` calls `simulateOrderForm` under the hood and has a documented side effect — calling it recomputes shipping totals on the orderForm; the next `getCart` will reflect any changes. This quirk of the underlying VTEX API is described where it matters; we don't try to "fix" it.

`applyCoupon` is the only operation with a non-uniform return shape. Coupon non-application is a known soft outcome (e.g. "added but no discount applied because no eligible items"), not an error — caller needs to know.

#### C. Typed errors

Co-located with the Cart module (`node/cart/errors.ts`):

```ts
export class InvalidSkuFormatError extends Error {
  constructor(public sku: string) { super(`Invalid SKU format: ${sku}`) }
}
export class ItemNotAddedError extends Error {
  constructor(public sku: string) { super(`SKU ${sku} not added by VTEX (likely unknown or out of stock)`) }
}
export class ItemNotInCartError extends Error {
  constructor(public sku: string) { super(`SKU ${sku} not in cart`) }
}
export class TransientCartError extends Error {
  constructor(public code: string) { super(`Transient VTEX cart error: ${code}`) }
}
export class OrderFormSubstitutedError extends Error {
  constructor(public requested: string, public received: string) {
    super(`VTEX substituted orderFormId: requested ${requested}, received ${received}`)
  }
}
```

Caller pattern (REST handler):

```ts
try {
  const updated = await cart.addItem(orderFormId, sku, qty)
  ctx.body = { success: true, cart: updated }
} catch (err) {
  if (err instanceof InvalidSkuFormatError) ctx.status = 400
  else if (err instanceof ItemNotAddedError) ctx.status = 422
  else if (err instanceof OrderFormSubstitutedError) ctx.status = 409
  else throw err
  ctx.body = { success: false, error: err.message }
}
```

Caller pattern (chat tool — prescriptive LLM-steering messages stay in the tool, not Cart):

```ts
try {
  const updated = await cart.addItem(orderFormId, sku, qty)
  return { result: `Added ${sku}, total ${updated.total} ${updated.currency}`, cartUpdated: true }
} catch (err) {
  if (err instanceof InvalidSkuFormatError) {
    return { result: `ERROR: SKU "${err.sku}" e invalid. Apelează get_product_details(productId) ...` }
  }
  // ... other typed errors
}
```

#### D. Cross-cutting rules — owned by Cart, applied uniformly

- **Fabricated-SKU rejection** — first thing in `addItem`/`setQuantity`. Throws `InvalidSkuFormatError` for any SKU not matching `^\d+$`.
- **ORD003 transient retry** — single retry with 350 ms back-off in `addItem`. If still fails, throws `TransientCartError('ORD003')`.
- **Actually-added check** — `addItem` snapshots quantity-before, calls `addItems`, fetches quantity-after, throws `ItemNotAddedError` if no delta. Catches VTEX silent-success bug for unknown SKUs.
- **Item-index lookup by SKU** — private helper used by `removeBySku` and `setQuantity`. Throws `ItemNotInCartError` if the SKU is not in the cart.
- **Coupon-actually-applied check** — `applyCoupon` measures discount delta before/after; returns `{ cart, applied: true | false, reason? }` accordingly. Reasons are short, factual ("no eligible items", "code not recognized" if VTEX surfaces that, etc.).
- **OrderForm substitution detection** — every operation that returns a `VTEXOrderForm` from the underlying client passes through a private `assertSameCart(returned, expected)` guard. Throws `OrderFormSubstitutedError` if VTEX silently swapped the id.
- **Logistics-info construction** — private helper for `setShippingAddress`, hides the `{ itemIndex, selectedSla: 'Normal', selectedDeliveryChannel: 'delivery' }` shape.

Expired-cart handling is **out of scope for typed translation** — VTEX's expiry-shaped errors bubble up as generic errors; the caller surfaces them. We add `CartExpiredError` if/when we hit it in production with confidence about its shape.

#### E. orderFormId resolution split

`utils/session.ts` keeps HTTP-side concerns; Cart owns the cart-domain operation:

```ts
// utils/session.ts
export function getOrderFormIdFromRequest(ctx: Context): string | null         // unchanged
export function setOrderFormCookie(ctx: Context, orderFormId: string): void    // new — factor out of getOrCreateOrderForm
export async function resolveOrderFormId(ctx: Context, cart: Cart): Promise<string> {
  const existing = getOrderFormIdFromRequest(ctx)
  if (existing) return existing
  const newCart = await cart.createCart()
  setOrderFormCookie(ctx, newCart.id)
  return newCart.id
}
```

The current `getOrCreateOrderForm(ctx)` is **deleted**. Callers migrate to `resolveOrderFormId(ctx, cart)` (or compose the steps manually if they want different behavior).

`Cart.createCart()` returns a full `SimpleCart` for the empty-cart case (not just an id) — keeps the return type uniform across operations.

#### F. Migration of REST handlers (`node/handlers/cart.ts`)

All eight REST handlers migrate to Cart:

```ts
// before (~30 lines)
export async function addToCart(ctx: Context) {
  const { sku, quantity = 1, seller = '1' } = await json(ctx.req)
  if (!sku) { ctx.status = 400; ctx.body = { success: false, error: 'Missing SKU' }; return }
  const orderFormId = await getOrCreateOrderForm(ctx)
  const orderForm = await ctx.clients.checkout.addItems(orderFormId, [{ id: sku, quantity, seller }])
  const cart = mapOrderFormToCart(orderForm)
  const addedItem = cart.items.find((item) => item.sku === sku)
  ctx.body = { success: true, cart, addedItem }
}

// after (~10 lines)
export async function addToCart(ctx: Context) {
  const { sku, quantity = 1 } = await json(ctx.req)
  const cart = new Cart({ checkout: ctx.clients.checkout })
  const orderFormId = await resolveOrderFormId(ctx, cart)
  try {
    const updated = await cart.addItem(orderFormId, sku, quantity)
    ctx.body = { success: true, cart: updated, addedItem: updated.items.find(i => i.sku === sku) }
  } catch (err) {
    handleCartError(ctx, err)   // small shared helper that maps typed errors to status codes
  }
}
```

All handlers in `node/handlers/cart.ts` get this shape. Net: ~250 lines removed from that file.

#### G. Migration of chat tool branches (`node/handlers/chat.ts`)

The eight cart-touching tool branches in the chat handler's `executeTool` switch migrate to Cart. Branches affected: `add_to_cart`, `get_cart`, `remove_from_cart`, `update_cart_quantity`, `apply_coupon`, `set_customer_profile`, `set_shipping_address`, `get_shipping_options`.

The branches keep their *output-shaping* responsibility (`ProductCardData`, `CartPreviewData`, `suggestions`, `cartUpdated` flag — these are chat-Surface concerns, not Cart's). What moves to Cart: the orderForm fetching, the cross-cutting rules, the index-by-SKU lookup, the actually-added check, the ORD003 retry. Net: ~150 lines removed from `chat.ts`.

The prescriptive LLM-steering error messages (`"ERROR: SKU \"${sku}\" e invalid. Apelează get_product_details(...)"`) **stay in the chat tool** — they're about steering the LLM's next action, not about cart-domain truth. Cart throws typed errors; the chat tool maps them to LLM-steering text.

#### H. Tests — `FakeCheckoutClient` + structure

A small in-memory `FakeCheckoutClient` (`node/cart/__tests__/fake-checkout.ts`) implements `CheckoutClient`'s interface against a `Map<orderFormId, VTEXOrderForm>`. Test-only — not exported from the package. Provides:

- The realistic methods (`getOrderForm`, `addItems`, `updateItems`, `removeItem`, `addCoupon`, `addClientProfileData`, `addShippingData`, `simulateOrderForm`, `createOrderForm`).
- Targeted injection points: `silentlyAccepts(sku)` (future `addItems` with this SKU updates state but the SKU is *not* added — VTEX silent-success bug); `failNextCall(method, error)` (one-shot failure injection); `substituteNextOrderFormId(replacement)` (one-shot id swap).

Tests use `node --test` + `tsx`, matching the `@acg/core` pattern.

Coverage:

- **Happy path** for all 9 operations (input → expected `SimpleCart`).
- **Cross-cutting rules** — one test per rule from section D, exercising the failure mode through the targeted injection points.
- **Substitution detection** — operations throw `OrderFormSubstitutedError` when `substituteNextOrderFormId` is configured.
- **applyCoupon's richer return** — `{ applied: true }` when discount delta > 0; `{ applied: false, reason }` when not.
- **Errors thrown with correct types** — `InvalidSkuFormatError.sku === inputSku`, `ItemNotInCartError.sku === inputSku`, etc.

Migration smoke tests are **light or skipped** — REST handlers and chat-tool branches become thin wrappers; Cart's tests cover the behavior. A handful of REST-handler smoke tests stay only where the handler does non-trivial mapping (e.g. defaulting `country: 'ROU'` in `setShippingAddress`).

### Grilling progress

All resolved 2026-05-05:

- ~~**Module shape.**~~ ✓ Class with explicit deps (`CartDeps = { checkout, log? }`); not registered in `IOClients`. See section A.
- ~~**Scope.**~~ ✓ Eight ops + `createCart` = 9 total. `getShippingOptions` included with documented side effect. `placeOrder`, `addPaymentData`, `removeCoupon`, `clearCart` explicitly out. See section B.
- ~~**Cross-cutting rules + signaling.**~~ ✓ Six rules owned by Cart; throws typed errors for hard failures, returns richer type for `applyCoupon`. See sections C and D.
- ~~**orderFormId resolution.**~~ ✓ Strict split — `utils/session.ts` owns HTTP read/write; `Cart.createCart()` owns the domain create; `resolveOrderFormId(ctx, cart)` is the convenience composer. `getOrCreateOrderForm(ctx)` deleted. See section E.
- ~~**Operations on missing/invalid carts.**~~ ✓ Pass-through plus an `assertSameCart` guard that throws `OrderFormSubstitutedError` on substitution. Expired-cart handling deferred until production gives us a real shape to translate.
- ~~**Migration scope.**~~ ✓ Full — both REST handlers (8) and chat-tool branches (8) migrate to Cart. See sections F and G.
- ~~**Test fake strategy.**~~ ✓ In-memory `FakeCheckoutClient` as default + per-test injection points; `node --test` + `tsx`. See section H.

### Deferred to follow-up issues (post-demo or as the need arises)

- **B2B fields on `setCustomerProfile`** — `isCorporate: false` is hardcoded today; B2B isn't supported. Adding when a B2B merchant joins.
- **`removeCoupon`, `clearCart`, multi-coupon listing** — not exposed today; not added speculatively. Filed if/when a flow needs them.
- **`mapOrderFormToCart` mixing presentation** — combines `name + " - " + skuName` into a single display name. Callers can't get the variant separately. Out of Issue 02; surfaces if a downstream consumer needs the split.
- **`CartExpiredError` typed translation** — bubbles up as generic VTEX error today. Add when production gives us a real shape.
- **Multi-seller cart support** — `addItems` accepts a `seller` parameter (defaults to `'1'`); not exercised, not surfaced through Cart's `addItem`. Add when multi-seller is needed.

### Architecture review notes (from 2026-05-04 review — historical)

- **Files:** `node/handlers/cart.ts`, the cart-touching branches in `node/handlers/chat.ts`, `node/clients/checkout.ts`.
- **Problem:** Cart Negotiation is a named sub-domain but a real smear. orderForm shape leaks. Cross-cutting rules duplicate and drift.
- **Solution:** introduce a `Cart` module — Cart Negotiation made concrete. Hides orderForm. Single home for the rules.
- **Benefits:**
  - **Locality:** cart bugs live in one place, not two-and-a-half.
  - **Leverage:** chat tool `add_to_cart` becomes one line. REST handler `addToCart` becomes one line. They can't drift.
  - **Tests:** test Cart against a fake `clients/checkout`. Today the same orderForm-introspection logic repeats with subtle differences — exactly what tests would catch.

### Comments

**2026-05-05** — Grilling complete (7 questions). All design questions resolved; Status flipped to `ready-for-agent`. Acceptance has eight sections (A–H) covering module shape, public operations, typed errors, cross-cutting rules, orderFormId resolution split, REST migration, chat migration, and test fake strategy.

`CONTEXT.md` updated inline with new entry: `Cart module` in §4 (Commerce surface). The `Session continuity` entry sharpened to mention `resolveOrderFormId`.

No ADR created during this grilling — the most architecturally consequential decision (deps-injected class for domain modules; not in IOClients) is shared with Issue 01's `MerchantIdentity` and could be lifted into a single ADR-0002 covering both. Offered to user; left for follow-up unless they want it now.
