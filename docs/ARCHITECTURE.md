# ACG — Configuration-Driven Architecture

**Status:** v1 = inline config in adapter settings (current). v2 = YAML-based per-client profiles.
**Last updated:** 2026-04-24

## Why this exists

Off-the-shelf chat widgets (Tidio, Intercom, most Shopify chat apps) force you into a template — every store looks the same, same questions, same buttons. They don't know whether you sell shoes, phones, or groceries.

**Our thesis:** a shopping assistant should adapt to the vertical. Fashion asks about size and color. Electronics asks about specs and compatibility. Grocery asks about dietary preferences. The CORE (chat flow, cart, Pinecone, checkout) is shared. The SURFACE (questions, filters, tools, tone) is per-client.

We achieve this with a **configuration contract** — a YAML per client that drives behavior at every layer.

---

## Architecture (four layers)

```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 1 — CLIENT CONFIG (YAML)                              │
│  brand · filters · starters · prompt · language · currency   │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│  LAYER 2 — ADAPTER (VTEX IO backend)                         │
│  • Reads config, injects into system prompt                  │
│  • Loads core tools + industry tool bundle                   │
│  • Validates add_to_cart against vertical schema             │
│  • Exposes GET /_v/acg/config for the widget                 │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│  LAYER 3 — WIDGET (pixel app, config-aware)                  │
│  • Fetches config from /_v/acg/config on mount               │
│  • Renders filter panel via component registry               │
│      swatch → <ColorSwatches>                                │
│      slider → <PriceSlider>                                  │
│      chips → <QuickReplies>                                  │
│      enum → <Chips>                                          │
│  • Localized copy, brand colors, starter chips               │
└─────────────────────────────┬────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│  LAYER 4 — GENERIC CORE (never changes per client)           │
│  Chat loop · message rendering · Pinecone · OpenAI · cart    │
│  session · persistence · error handling                      │
└──────────────────────────────────────────────────────────────┘
```

**Layers 1-3 are per-client. Layer 4 is the product.**

---

## Client config schema (v2 target)

Stored as YAML per client. Validated with `zod` at adapter startup.

```yaml
# clients/miniprix.yaml
industry: fashion
currency: RON

locales:
  default: ro
  available: [ro, en]

brand:
  name: Miniprix
  tone: friendly, casual, Romanian idioms OK
  accent_color: "#f71963"
  logo_url: "https://..."

# What we offer the LLM as industry context
llm_context: |
  Miniprix e un retailer românesc accesibil.
  Sezon curent: primăvară-vară 2026.
  Focus: haine damă (50%), copii (30%), bărbați (20%).
  Ton: prietenos, tutuim clienții. Fără corporate-speak.

# Quick-reply chips shown at empty state
quick_starters:
  ro:
    - "Ținută pentru birou"
    - "Cadou pentru copil"
    - "Ce e la reducere?"
    - "Caut ceva pentru femei"
  en:
    - "Office outfit"
    - "Gift for a child"
    - "What's on sale?"

# Dimensions the shopper will filter by
filters:
  - name: gender
    type: enum
    ui: chips
    values: [Femei, Bărbați, Copii]
    required_for_outfit: true
  - name: size
    type: enum_per_category
    ui: chips
    clothing: [XS, S, M, L, XL]
    shoes: [35, 36, 37, 38, 39, 40, 41, 42]
  - name: color
    type: swatch
    palette:
      - { label: "Negru", hex: "#000000" }
      - { label: "Alb", hex: "#ffffff" }
      - { label: "Roșu", hex: "#dc2626" }
      - { label: "Albastru", hex: "#2563eb" }
      - { label: "Bej", hex: "#d4a574" }
  - name: price
    type: slider
    min: 0
    max: 1000

# Strings localized per locale
strings:
  ro:
    greeting: "Salut! Sunt asistentul tău de shopping. Cu ce te pot ajuta?"
    placeholder: "Scrie un mesaj..."
    header_title: "Asistent Shopping"
    cart_empty: "Coșul e gol."
  en:
    greeting: "Hi! I'm your shopping assistant. How can I help?"
    placeholder: "Type a message..."
    header_title: "Shopping Assistant"
    cart_empty: "Your cart is empty."
```

## Contrast: electronics client

```yaml
# clients/tech-shop.yaml
industry: electronics
currency: USD

brand:
  name: TechShop
  tone: precise, no emojis, technical accuracy matters

llm_context: |
  Tech reseller focused on accurate spec comparisons.
  When asked about compatibility, verify explicitly before confirming.
  Never guess on warranty terms — always check.

quick_starters:
  en:
    - "Laptops under $1000"
    - "Best phones 2026"
    - "Compare X vs Y"

filters:
  - name: category
    type: enum
    values: [Laptops, Phones, Headphones, Smart Home]
  - name: brand
    type: enum_filtered_by_category
  - name: price
    type: slider
    min: 0
    max: 5000
  - name: specs
    type: conditional
    when_category: Laptops
    dimensions: [ram_gb, storage_gb, cpu, gpu, screen_size]
  - name: warranty
    type: enum
    values: [1 year, 2 years, 3+ years]
```

---

## Specialized LLM tools per vertical

This is the big architectural win. Core tools stay the same. Industry bundles add specialized capabilities.

### Core tools (always loaded)

```typescript
const CORE_TOOLS = [
  'search_products',        // semantic + keyword search
  'get_product_details',    // SKU → full info + variants
  'add_to_cart',
  'get_cart',
  'remove_from_cart',
  'update_cart_quantity',
  'apply_coupon',
  'set_customer_profile',
  'set_shipping_address',
  'get_shipping_options',
  'propose_deal',
  'checkout',
  'check_order_status',
  'suggest_replies',        // quick-reply chips
]
```

### Fashion bundle

```typescript
const FASHION_TOOLS = [
  {
    name: 'find_outfit',
    description: 'Search for a complete outfit. Makes multiple parallel searches for shirt/pants/shoes/accessories matching style + gender + budget.',
    parameters: {
      style: 'business | casual | evening | sport',
      gender: 'women | men | unisex',
      budget: 'number (max total)',
      occasion: 'string (optional, e.g. "wedding", "office")'
    }
    // Internally runs 4 search_products in parallel
  },
  {
    name: 'check_size_guide',
    description: 'Get size chart for a product (EU↔US↔UK, chest/waist/hip measurements).',
    parameters: { productId }
  },
  {
    name: 'suggest_accessories',
    description: 'Given a product in cart, suggest matching accessories.',
    parameters: { productId }
  }
]
```

### Electronics bundle

```typescript
const ELECTRONICS_TOOLS = [
  {
    name: 'compare_specs',
    description: 'Side-by-side comparison of 2-4 products on given attributes.',
    parameters: {
      productIds: 'array of SKUs (max 4)',
      attributes: 'array of spec keys to compare'
    }
  },
  {
    name: 'check_compatibility',
    description: 'Does product A work with product B? (e.g., does this keyboard work with this laptop)',
    parameters: { productIdA, productIdB }
  },
  {
    name: 'find_alternatives',
    description: 'Find products with similar specs at different price points.',
    parameters: { productId, directionHint: 'cheaper | premium' }
  }
]
```

### Grocery bundle

```typescript
const GROCERY_TOOLS = [
  {
    name: 'suggest_recipe',
    description: 'Given ingredients the user has, suggest a recipe and identify missing ingredients to add to cart.',
    parameters: {
      ingredients_on_hand: 'array',
      dietary_restrictions: 'array (e.g. vegetarian, gluten-free)'
    }
  },
  {
    name: 'plan_weekly_meals',
    description: 'Build a 7-day meal plan + shopping list.',
    parameters: { people_count, budget, dietary_restrictions }
  }
]
```

### Loading pattern

```typescript
// packages/vtex-io-adapter/node/handlers/chat.ts
async function chatHandler(ctx: Context) {
  const config = await loadClientConfig(ctx)  // from adapter settings or /acg/config

  const tools = [
    ...CORE_TOOLS,
    ...getIndustryBundle(config.industry),
  ]

  const systemPrompt = buildSystemPrompt(config)  // injects llm_context

  const response = await llm.chat(messages, tools, maxTokens)
  // ...
}

function getIndustryBundle(industry: string): LLMTool[] {
  switch (industry) {
    case 'fashion': return FASHION_TOOLS
    case 'electronics': return ELECTRONICS_TOOLS
    case 'grocery': return GROCERY_TOOLS
    default: return []
  }
}
```

### Why this matters

1. **Better LLM tool selection** — fewer, more relevant tools = fewer wrong calls
2. **Cheaper context** — tool descriptions are ~100 tokens each
3. **Easier to add verticals** — new bundle, no rewrites
4. **Cleaner prompts** — `llm_context` speaks the vertical's language

Don't load all tools for all clients. Be deliberate.

---

## UI component registry (widget side)

Every filter type maps to a React component. The widget reads the config and renders the right picker.

```tsx
// widget/filters/registry.ts
const FILTER_COMPONENTS = {
  chips: QuickReplies,
  enum: Chips,
  swatch: ColorSwatches,
  slider: PriceSlider,
  enum_per_category: ConditionalChips,
  conditional: ConditionalFilter,
}

function FilterPanel({ filters }: Props) {
  return filters.map((filter) => {
    const Component = FILTER_COMPONENTS[filter.type]
    return <Component key={filter.name} config={filter} />
  })
}
```

Adding a new filter type = add a component + register it. No core changes.

---

## Validation with zod

```typescript
import { z } from 'zod'

const FilterSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('enum'),
    name: z.string(),
    ui: z.enum(['chips', 'dropdown']),
    values: z.array(z.string()),
  }),
  z.object({
    type: z.literal('swatch'),
    name: z.string(),
    palette: z.array(z.object({ label: z.string(), hex: z.string() })),
  }),
  z.object({
    type: z.literal('slider'),
    name: z.string(),
    min: z.number(),
    max: z.number(),
  }),
  // ...
])

const ClientConfigSchema = z.object({
  industry: z.enum(['fashion', 'electronics', 'grocery', 'home', 'beauty']),
  currency: z.string().length(3),
  brand: z.object({
    name: z.string(),
    tone: z.string(),
    accent_color: z.string().regex(/^#[0-9a-f]{6}$/i),
  }),
  llm_context: z.string().min(50),
  quick_starters: z.record(z.string(), z.array(z.string()).min(2).max(6)),
  filters: z.array(FilterSchema),
  strings: z.record(z.string(), z.record(z.string(), z.string())),
})

// On startup:
const config = ClientConfigSchema.parse(loadYaml('miniprix.yaml'))
// Fails fast with a clear error if config is malformed
```

---

## Implementation roadmap

### Phase 1 (current / v1) — inline config in adapter settings

Already implemented:
- `settingsSchema` in manifest.json with LLM provider, API keys
- `llm_context` effectively hardcoded in chat.ts system prompt
- Starter chips hardcoded in widget

**Fine for miniprix demo.** Don't over-engineer yet.

### Phase 2 — YAML-driven per-client config

- [ ] Define full `ClientConfigSchema` with zod
- [ ] Add `packages/acg-profiles/clients/*.yaml` for each client
- [ ] New adapter route: `GET /_v/acg/config` — returns the active client's config
- [ ] Widget fetches config on mount, renders starters/strings/filters from it
- [ ] `buildSystemPrompt` reads `llm_context` from config

### Phase 3 — Industry tool bundles

- [ ] `FASHION_TOOLS` with `find_outfit`, `check_size_guide`
- [ ] `ELECTRONICS_TOOLS` with `compare_specs`, `check_compatibility`
- [ ] Conditional loading based on `config.industry`

### Phase 4 — Filter UI component registry

- [ ] `<ColorSwatches>`, `<PriceSlider>`, `<ConditionalChips>`
- [ ] Registry in widget
- [ ] FilterPanel that renders from config

### Phase 5 — Merchant-configurable via VTEX Admin

- [ ] Admin UI to edit client config (no YAML file)
- [ ] Config stored in VBase per workspace
- [ ] Hot-reload via admin save

---

## Competitive positioning

| Widget | Approach | Weakness |
|--------|----------|----------|
| Tidio / Intercom | Rule-based conversation trees | Not AI, scales poorly |
| Shopify Sidekick | LLM + fixed Shopify schema | Shopify-only, no customization |
| Rep AI / similar | LLM + minimal config | Single industry (fashion) |
| Zendesk AI | LLM + knowledge base | Support-focused, not commerce |
| **ACG (us)** | **Config-driven multi-vertical** | **WIP — shipping differentiator** |

No polished competitor in the "config-driven multi-vertical shopping assistant" space. This is our opening.

---

## Decision log

**2026-04-24:** Adopted YAML + zod over:
- JSON Schema directly (harder to author, no inline comments)
- Proprietary DSL (overkill)
- VTEX Master Data config app (too tied to VTEX, blocks portability)

**2026-04-24:** Chose per-industry tool bundles over:
- "Load all tools always" (worse LLM performance, more tokens)
- "Dynamic tool discovery" (LLM can't usefully pick from 100+ tools)

**2026-04-24:** Chose config-based strings over VTEX `vtex.messages`:
- Pixel apps mount outside render-runtime (useIntl unavailable)
- Can revisit when we ship to vtex.messages-aware apps

---

## Related files

- `packages/vtex-io-adapter/node/handlers/chat.ts` — where tool bundles would load
- `packages/vtex-io-adapter/manifest.json` — current v1 settingsSchema
- `apps/acg-chat-widget/react/index.tsx` — where widget reads config
- `docs/SHOWCASE_PLAN.md` — delivery plan (v1 demo first, v2 after)
