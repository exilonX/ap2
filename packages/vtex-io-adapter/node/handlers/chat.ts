/* eslint-disable no-console, no-await-in-loop -- pre-existing instrumentation; tracked by issue 0005 (Logger injection) and the LLM tool-call loop's intentional sequencing */

import { json } from 'co-body'

import { Cart } from '../cart/cart'
import type { VTEXOrderForm } from '../clients/checkout'
import {
  InvalidSkuFormatError,
  ItemNotAddedError,
  ItemNotInCartError,
  OrderFormSubstitutedError,
  TransientCartError,
} from '../cart/errors'
import { ClaudeClient, GeminiClient, OpenAIClient } from '../clients/llm'
import type {
  LLMMessage,
  LLMTool,
  LLMToolCall,
  LLMResponse,
  LLMProvider,
} from '../clients/llm'
import { loadConfigForAccount } from '../config/load'
import type { ClientConfig } from '../config/types'
import {
  formatCustomerProfile,
  formatShippingAddress,
  mapOrderFormToCart,
} from '../mappers/cart'
import { mapProduct } from '../mappers/product'
import { curatePaymentMethods } from '../utils/payment-methods'
import { getOrderFormIdFromRequest, resolveOrderFormId } from '../utils/session'
import { semanticSearch } from './rag'
// Importing this module registers all AgentTools (Issue 03 — AP2 ceremony).
import '../agent-tools'
import {
  dispatch as dispatchAgentTool,
  getDefinitions as getAgentToolDefinitions,
} from '../agent-tools/registry'
// The widget Pay-Now orchestrator (tryPayNow) drives these three tools as
// one server-side sequence inside a single HTTP request — see CheckoutState.
import { placeOrderTool } from '../agent-tools/place-order'
import { sendPaymentInfoTool } from '../agent-tools/send-payment-info'
import { authorizeTransactionTool } from '../agent-tools/authorize-transaction'
import type {
  CartPreviewData,
  CheckoutState,
  MandateInfo,
  PaymentMethodOption,
  ProductCardData,
  ToolContext,
  ToolEffect,
} from '../agent-tools/types'

// ─── Types ─────────────────────────────────────────────────────

interface ChatRequest {
  message: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  orderFormId?: string
}

// ProductCardData, CartPreviewItem, CartPreviewData, MandateInfo —
// shared with the AgentTool surface (`node/agent-tools/types.ts`).
// Keeping the source of truth there lets future industry tool bundles
// stay aligned with the chat handler's accumulator without drift.

interface ChatResponse {
  reply: string
  products?: ProductCardData[]
  suggestions?: string[] // quick-reply chips to render after the reply
  cartPreview?: CartPreviewData // structured cart snapshot to render inline
  cartUpdated?: boolean
  mandate?: MandateInfo // present when the checkout tool signed a CartMandate
  /**
   * Pill buttons for the widget to render. Populated by
   * list_payment_methods. Latest call wins so the user always sees the
   * methods relevant to the current cart state.
   */
  paymentMethods?: PaymentMethodOption[]
  /**
   * Order review shown by the widget after a payment method is chosen and
   * BEFORE placement. The server returns this from tryPayNow Phase A (the
   * payment-pill turn) once the chosen method is the sole payment and the
   * profile + shipping preconditions place_order enforces are satisfied.
   * The widget renders it as a confirmation panel and surfaces a single
   * "Plătește acum" Pay-Now chip; clicking it sends the PAY_NOW sentinel
   * which tryPayNow Phase B turns into the real place → send → authorize
   * sequence. `total` is in CENTS (integer) to match cartPreview.
   */
  orderReview?: {
    customerProfile?: {
      name?: string
      email?: string
      phone?: string
      document?: string
    }
    shippingAddress?: string
    selectedPayment?: { id: string; name: string; group?: string }
    total: number // CENTS (integer)
    currency: string
  }
}

interface AppSettings {
  llmProvider?: LLMProvider
  claudeApiKey?: string
  claudeModel?: string
  openaiApiKey?: string
  openaiModel?: string
  geminiApiKey?: string
  geminiModel?: string
}

// ─── Tool Definitions ──────────────────────────────────────────

const CHAT_TOOLS: LLMTool[] = [
  // ── Search & Browse ──
  {
    name: 'search_products',
    description:
      'Search for products in the store catalog. Use when the customer is looking for products, asks about availability, or wants recommendations.\n\nHARD PRECONDITION — gender-coded apparel: if the request mentions an apparel item that has separate men\'s/women\'s/kids\' versions (cămașă/camasa, pantaloni, rochie/rochie, fustă/fusta, sacou/sacou, geacă/geaca, pulovăr/pulover, tricou, blugi, costum, hanorac, palton) AND the request does NOT include an explicit gender signal, you MUST NOT call this tool yet. Instead, call suggest_replies first with options like ["Bărbați", "Damă", "Copil"] and ask the customer. Implicit gender signals that DO unblock the search: "rochie/fustă" (already female), "pentru tata/băiat/soț" (male), "pentru mama/sora/soție" (female), "pentru copil" (kids).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search query (e.g., "running shoes", "red dress size M"). For apparel, MUST include gender qualifier (bărbați/damă/copil).',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 4)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product_details',
    description:
      'Get detailed info about a specific product by SKU. Use when the customer asks about a specific product (size, material, specs).',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The product SKU ID' },
      },
      required: ['sku'],
    },
  },

  // ── Cart CRUD ──
  {
    name: 'add_to_cart',
    description: 'Add a product to the shopping cart.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The product SKU to add' },
        quantity: {
          type: 'number',
          description: 'Quantity to add (default 1)',
        },
      },
      required: ['sku'],
    },
  },
  {
    name: 'get_cart',
    description: 'View the current shopping cart contents, totals, and status.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'remove_from_cart',
    description: 'Remove an item from the cart by SKU.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The SKU to remove from cart' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'update_cart_quantity',
    description: 'Change the quantity of an item already in the cart.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'The product SKU to update' },
        quantity: {
          type: 'number',
          description: 'New quantity (must be >= 1)',
        },
      },
      required: ['sku', 'quantity'],
    },
  },
  {
    name: 'apply_coupon',
    description: 'Apply a coupon or promo code to the cart.',
    parameters: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The coupon or promo code (e.g., "VIP15")',
        },
      },
      required: ['code'],
    },
  },

  // ── Customer & Shipping ──
  {
    name: 'set_customer_profile',
    description:
      'Set the customer profile on the cart. Use when the customer provides their contact details for checkout.',
    parameters: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Customer email address' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        phone: { type: 'string', description: 'Phone number' },
      },
      required: ['email', 'firstName', 'lastName'],
    },
  },
  {
    name: 'set_shipping_address',
    description:
      'Set the shipping address on the cart. Use when the customer provides their delivery address.',
    parameters: {
      type: 'object',
      properties: {
        street: { type: 'string', description: 'Street name' },
        number: { type: 'string', description: 'Street number' },
        city: { type: 'string', description: 'City' },
        state: { type: 'string', description: 'State or province' },
        postalCode: { type: 'string', description: 'Postal/ZIP code' },
        country: {
          type: 'string',
          description: 'Country code (e.g., "ROU", "BRA", "USA")',
        },
        complement: {
          type: 'string',
          description: 'Apartment, suite, etc. (optional)',
        },
      },
      required: ['street', 'number', 'city', 'state', 'postalCode', 'country'],
    },
  },
  {
    name: 'get_shipping_options',
    description:
      'Get available shipping methods and their costs. Use after a shipping address has been set.',
    parameters: { type: 'object', properties: {} },
  },

  // ── Intelligence ──
  {
    name: 'propose_deal',
    description:
      'Analyze the current cart and suggest deals, discounts, or ways to save money. Use proactively when a customer has items in their cart.',
    parameters: { type: 'object', properties: {} },
  },

  // ── Checkout ──
  // Issue 03 split the legacy `checkout` tool into 3 AP2-ceremony tools
  // that live as AgentTools under `node/agent-tools/`:
  //   - create_cart_mandate            (sign-only, the demo's first beat)
  //   - execute_payment                (verify drift + mock-place order)
  //   - redirect_to_native_checkout    (Path A handoff)
  // They are appended to the LLM-facing tool list at chat-time via
  // `getAgentToolDefinitions()`. See the `[...CHAT_TOOLS, ...]` site below.

  {
    name: 'check_order_status',
    description: 'Check the status of an existing order by order ID.',
    parameters: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'The order ID to look up' },
      },
      required: ['orderId'],
    },
  },

  // ── Quick replies for the UI ──
  {
    name: 'suggest_replies',
    description:
      'Attach up to 4 quick-reply chips to your message. Use this when the customer might benefit from tapping a follow-up instead of typing. Good moments: after a broad query (suggest filters like sizes/colors), after suggesting products (propose next actions like "Adaugă primul în coș", "Vreau mai multe opțiuni"), when clarification helps (e.g., "Pentru femei" / "Pentru bărbați"). Each option must be a complete phrase in the customer\'s language, short (≤30 chars).',
    parameters: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Up to 4 quick-reply options',
          maxItems: 4,
        },
      },
      required: ['options'],
    },
  },
]

// ─── System Prompt ──────────────────────────────────────────────

function buildSystemPrompt(config: ClientConfig): string {
  const storeName = config.brand.name
  const { currency } = config
  const defaultLocale = config.locales.default

  // Merchant-specific context block (injected verbatim)
  const merchantContext = config.llmContext.trim()

  // Tone hint
  const toneLine = config.brand.tone ? `Ton: ${config.brand.tone}.` : ''

  // Optional behavior toggles with sensible defaults
  const confirmationStyle = config.confirmationStyle ?? 'verbose'
  const multiStepFlow = config.multiStepFlow ?? 'stepwise'

  // Custom rules section — empty if not configured
  const customRulesSection =
    config.customRules && config.customRules.length > 0
      ? `\n## CUSTOM RULES (specific magazinului)\n${config.customRules
          .map((r) => `- ${r}`)
          .join('\n')}\n`
      : ''

  // Multi-step intent block — swaps based on flow preference
  const multiStepSection =
    multiStepFlow === 'stepwise'
      ? `## INTENȚII COMPUSE — PAS CU PAS
Pentru goluri compuse care acoperă mai multe categorii (ex: "ținută completă", "cadou complet", "tot ce am nevoie pentru X", "pachet pentru Y") → NU căuta toate deodată.

1. Clarifică detalii lipsă cu suggest_replies (gen, stil, vârstă, etc.).
2. Atacă UNA SINGURĂ categorie pe rând — începe cu cea centrală.
3. Lasă clientul să aleagă, confirmă, apoi treci la următoarea.
4. La fiecare pas: suggest_replies ["Continuu cu <next>", "Vreau altă piesă", "Finalizez"].

NU apela 3-4 search_products în paralel. Clientul nu poate procesa atâtea opțiuni; doar primul rând se folosește, restul e irosit.

## CALITATE QUERY search_products — CRITIC
search_products folosește căutare semantică. Termeni vagi întorc rezultate proaste.

INTERZIS în query: "ținută", "outfit", "tot ce am nevoie", "look", "set complet".
Aceste cuvinte încadrează pe orice — cu "ținută birou femei" engine-ul întoarce GENȚI înainte de rochii fiindcă "office accessory" se potrivește semantic.

CORECT: query cu un TIP DE PRODUCT specific.
- "rochie birou damă" ✓
- "sacou damă birou" ✓
- "pantofi damă office" ✓
- "ținută birou femei" ✗ (returnează genți)
- "cadou complet copil" ✗ (returnează aleator)
- "look casual" ✗

Când clientul cere ceva vag ("ținută completă", "cadou"), sari direct la PRIMA categorie specifică (de obicei piesa centrală). NU traduce intenția vagă într-un query vag.

INCLUDE CALIFICATIVE când clientul le menționează:
- Lungime: "pantaloni LUNGI damă elegant" (NU doar "pantaloni damă elegant" dacă clientul a spus lung)
- Cu/fără mâneci: "rochie cu mâneci lungi" / "rochie fără mâneci"
- Sezon: "haine de vară" / "geacă de iarnă"
- Tonuri: "albastru deschis" / "albastru închis"

Engine-ul semantic ranchează slab calificativele vs substantiv — dacă uiți "lungi", returnează "Pantaloni scurti" tot la fel. Inclusiv calificativul ajută atât semantic cât și filtrul intern.

NU include în query: mărimea (S/M/L/38/W29) sau culoarea când nu e calificativ esențial — engine-ul filtrează prost după astea. Folosește mărimea/culoarea după click pentru selectarea variantei corecte.`
      : `## INTENȚII COMPUSE — PARALEL
Pentru goluri compuse ("ținută completă", "cadou complet", "setup complet"), apelează MULTIPLE search_products în paralel — câte unul per categorie. Card-urile se grupează vizual și clientul poate compara opțiuni rapid.

Exemple:
- "ținută business pentru femei" → 3 căutări paralele: cămașă/pantaloni/jachetă damă business
- "setup gaming complet" → căutări paralele: monitor/tastatură/mouse/căști gaming

## CALITATE QUERY search_products
Query-urile trebuie să specifice TIPUL DE PRODUS, nu intenția. NU folosi "ținută/outfit/look/cadou" în query — engine-ul semantic întoarce rezultate aleatoare. Folosește termeni concreți: "cămașă damă business", "pantaloni damă elegant", etc.`

  // Confirmation style block — swaps add_to_cart behavior
  const confirmationSection =
    confirmationStyle === 'verbose'
      ? `## STIL DE CONFIRMARE — VERBOSE
Pentru ORICE add_to_cart: confirmă cu clientul ÎNAINTE de a apela tool-ul, chiar și pentru produse cu variantă unică.
- Multi-variantă: "Alege mărimea preferată:" + suggest_replies cu opțiuni
- Variantă unică: "Acest produs e disponibil doar în <variantă>. Adaug în coș?" + suggest_replies ["Da, adaugă", "Nu"]
- Adaugă DOAR după confirmare explicită.`
      : `## STIL DE CONFIRMARE — TERSE
Adaugă fluent fără confirmări extra:
- Multi-variantă: cere mărimea o dată cu suggest_replies, apoi adaugă imediat ce primești
- Variantă unică: adaugă direct și confirmă în text ("Am adăugat X mărimea M — total 89 RON ✓")
- Nu întreba "Adaug în coș?" pentru variante unice — doar adaugă și confirmă post-fact.`

  return `Ești asistent de shopping pentru ${storeName}. Limbă: ${defaultLocale} (sau cea a clientului). Monedă: ${currency}.

## CONTEXT
${merchantContext}
${toneLine}
${customRulesSection}

## REGULĂ #1 — GEN PENTRU APAREL (HARD STOP, citește ÎNAINTE de orice altceva)

Înainte de a apela search_products pentru orice piesă de îmbrăcăminte gen-codată, verifică dacă cererea conține un semnal explicit de gen. Dacă NU, apelează ÎNTÂI suggest_replies cu ["Bărbați", "Damă", "Copil"] și AȘTEAPTĂ răspunsul. NU APELA search_products fără gen.

Piese gen-codate (cu și fără diacritice — clienții români tastează ambele):
cămașă/camasa · pantaloni · rochie · fustă/fusta · sacou · geacă/geaca · pulovăr/pulover · tricou · blugi · costum · hanorac · palton

Cazuri concrete:
- "Vreau o cămașă" / "vreau o camasa" → ÎNTREABĂ ("Pentru bărbați sau damă?")
- "Caut pantaloni si o camasa" → ÎNTREABĂ o singură dată (acoperă ambele piese)
- "O cămașă neagră" → ÎNTREABĂ (culoarea NU e semnal de gen)
- "Pantaloni mărimea L" → ÎNTREABĂ (mărimea NU e semnal de gen)

Semnale care UNLOCK direct search_products (fără să întrebi):
- **MEMORIA CONVERSAȚIEI** — dacă în această sesiune clientul a stabilit deja un gen (a răspuns "Damă"/"Bărbați" la un suggest_replies anterior, a căutat anterior "pantaloni damă", a adăugat în coș produse pentru damă, etc.), CARRY THAT GENDER FORWARD. NU întreba din nou. O singură întrebare per sesiune e regula.
- Cuvântul în sine indică gen: "rochie", "fustă" → damă · "blazer cravată" → bărbați
- Pronume / relație: "pentru tata/soț/băiat/iubit" → bărbați · "pentru mama/sora/soție/iubita" → damă · "pentru copil/copii" → kids
- Cuvânt explicit: "cămașă bărbați", "pantaloni damă"

Exemple de memoria conversației:
- Turn 1: client caută "fustă cu imprimeu floral" → genul e damă (implicit din "fustă"). Salvează mental: "context: damă"
- Turn 2: client zice "vreau și o cămașă albă" → folosește genul deja stabilit (damă). NU întreba. Caută "cămașă damă albă".
- Turn 3: client zice "vreau și o pereche de pantofi" → folosește genul deja stabilit (damă). NU întreba. Caută "pantofi damă".

NU GHICI niciodată în absența genului. DAR dacă genul a fost deja stabilit în această sesiune, FOLOSEȘTE-L. Regula este: întreabă MAX o dată per sesiune. Amestecul (cămașă damă + pantaloni bărbați în același coș) și întrebări repetate (clientul deja a răspuns!) sunt ambele rele.

## REGULI DE GRUNDARE
Spune DOAR ce ai primit din tool-uri. Nu inventa: nume, SKU-uri, prețuri, stoc, mărimi, culori, descrieri, conținut coș, costuri/timpi livrare. Dacă tool-ul întoarce gol/eroare, spune onest. Dacă întoarce mai puțin decât s-a cerut, "am găsit doar X".

## STIL
Concis (1-3 fraze). Câmpurile structurate din tool results (produse, coș, mandat) apar automat — NU le repeta în text. Checkout doar la cerere explicită.

## CHECKOUT FLOW (CRITIC — citește atent)

Când clientul indică intenția de checkout — "checkout", "finalizez comanda", "plătesc", "cumpăr", "hai la plată", "gata, atât", "finalizare", etc. — apelează IMEDIAT **list_payment_methods**. Asta întoarce metodele de plată configurate ale comerciantului ca butoane pe care clientul le apasă (NU le re-lista în text — widget-ul le afișează automat).

Apoi AȘTEAPTĂ alegerea clientului. Când clientul indică o metodă (apasă un buton sau scrie "cash" / "card" / "vreau cu numerar" / numele unei metode), serverul preia controlul: fixează metoda pe coș, afișează un REZUMAT al comenzii (total + metodă) și așteaptă ca clientul să apese explicit "Plătește acum". TU NU apela **place_order**, **send_payment_info** sau **authorize_transaction** — serverul le rulează când clientul confirmă Pay-Now. Răspunde scurt, de tipul "Verifică rezumatul comenzii și apasă Plătește acum când ești gata." și așteaptă următoarea tură.

INTERZIS la checkout (clientul are deja datele pre-configurate pe cont):
- NU apela **set_customer_profile** (nume / email / telefon)
- NU apela **set_shipping_address** (adresa de livrare)
- NU apela **get_shipping_options**
- NU ÎNTREBA clientul pentru date personale / adresă / cod poștal / județ

Dacă flow-ul s-a încheiat cu succes (mandate + cartPreview apar în răspuns, authorize_transaction a întors "approved"), răspunde scurt în text — UN SINGUR RÂND — cum ar fi: "Gata, comanda este plasată. Mandatul AP2 confirmă cumpărătura." Widget-ul afișează badge-ul cu cartMandateId și link-ul de verificare automat.

Folosește **redirect_to_native_checkout** DOAR dacă clientul cere EXPLICIT "vreau checkout VTEX standard" sau similar. Default e in-chat headless via cele 4 tool-uri de mai sus.

${multiStepSection}

${confirmationSection}

## TOOL-URI
- **search_products**: rezultatele sunt deja filtrate in-stock; nu vorbi despre "alte opțiuni".
- **get_product_details**: OBLIGATORIU înainte de add_to_cart. Output-ul se termină cu "ACTION: ..." — urmeaz-o EXACT:
  - "add_to_cart direct" → adaugă fără să întrebi
  - "NU apela add_to_cart" + "suggest_replies cu options=[...]" → răspunde scurt ("Alege mărimea:") și apelează suggest_replies cu chips-urile exacte din output
  - "OUT OF STOCK" → nu adăuga, oferă alternative
- **add_to_cart**: după succes, output-ul are o linie "CONFIRMATION: ..." cu un template. Folosește-l — confirmă INCLUZÂND varianta (mărime/culoare). RĂU: "Adăugat" / "Cercei adăugați". BUN: "Am adăugat Cercei eleganti (varianta unică) — total 39 RON ✓".
- **get_cart**: APELEAZĂ-L pentru ORICE întrebare despre coș (mărime, preț, culoare, conținut). Numele din coș conține varianta. NU spune "nu am detalii" / "am pierdut contextul" — datele sunt în coș, citește-le.
- **suggest_replies**: 2-4 chips ≤30 char, în limba clientului. Bune la: clarificări ("Pentru femei?"), mărimi/culori, filtre ("Ceva mai ieftin"). Sărite când acțiunea e evidentă pe card.

## CLICK PE CARD (mesaj "Vreau X (SKU referință: Y) — ajută-mă să aleg varianta potrivită")
Y e DOAR prima variantă afișată, NU alegerea clientului. Apelează get_product_details(Y) și urmează ACTION.

## CHIPS-URILE SUNT OPȚIONALE
Chips-urile sunt scurtături. Clientul poate scrie ORICE liber și acel text CÂȘTIGĂ. Text liber → execută imediat tool-ul potrivit (search/get_cart/get_product_details).

NICIODATĂ nu spune: "alege din opțiuni", "apasă pe chips", "chips-urile sunt deja atașate", "aștept alegerea ta din chips". Sunt fraze interzise — blochează clientul.

Exemple: clientul scrie "ai și XL?" după chips ["S","M","L"] → caută XL, NU "alege din chips". "ceva mai elegant?" → re-search, NU "apasă pe chips".

## INTERZIS
- add_to_cart fără get_product_details prealabil
- add_to_cart același SKU de 2× într-un mesaj
- add_to_cart la pachet fără cerere EXPLICITĂ a clientului
- A ghici mărimea în numele clientului
- A ignora ACTION din get_product_details
- Confirmare add fără variantă (mărime/culoare)

## SKU-uri — NU CONSTRUI, COPIAZĂ
SKU-urile VTEX sunt itemId-uri numerice (ex: "590551", "574237"). NU sunt productId + variantă.

INTERZIS să construiești SKU-uri:
- ❌ "588600_M" (productId + label)
- ❌ "574237-Negru" (productId - culoare)
- ❌ "590776_W29 L32"

CORECT:
- ✓ Apelează get_product_details(productId) pentru a vedea SKU-urile reale ale variantelor
- ✓ Output-ul are linii "SKU 590551: ..." — copiază EXACT acel număr
- ✓ Folosește doar SKU-uri returnate de tool

Când clientul răspunde cu o mărime/variantă într-o nouă turnă, get_product_details din mesajul anterior NU mai e accesibil. RE-APELEAZĂ get_product_details(productId) înainte de add_to_cart pentru a obține SKU-ul corect al variantei alese. Niciodată să nu inventezi SKU-uri.

## ANTI-HALUCINARE — REGULĂ CRUCIALĂ
Spui "am adăugat" / "adăugat în coș" / "am scos" / "am aplicat" DOAR dacă ai apelat tool-ul corespunzător în acest mesaj ȘI a returnat succes.
- Vrei să adaugi → APELEAZĂ add_to_cart, abia apoi confirmă
- Vrei să scoți → APELEAZĂ remove_from_cart, abia apoi confirmă
- Niciodată nu fabrica un rezultat. Dacă tool-ul nu a rulat, produsul NU e în coș.

Verifică-te: în acest mesaj, ai apelat add_to_cart efectiv? Dacă NU, nu ai voie să spui "adăugat".

## CONFIRMARE OBLIGATORIE DUPĂ ADD/REMOVE
După ce add_to_cart sau remove_from_cart a rulat cu succes, OPRESTE-TE și confirmă VIZIBIL clientului în acest mesaj. NU sări direct la următorul search/get_product_details. Etape:

1. add_to_cart returnează rezultatul cu varianta + total
2. Răspunsul tău TEXT trebuie să confirme explicit: "Am adăugat <produs> (mărime, culoare) — total X RON ✓"
3. ABIA în următorul mesaj al clientului poți continua (cu sugestii / search nou / etc.)

Greșit: add_to_cart → search_products(altceva) → text "Iată următoarele opțiuni..." (clientul nu știe că s-a adăugat ceva)
Corect: add_to_cart → text "Am adăugat X mărimea S — total 89 RON ✓ Vrei să continui cu pantalonii?" + suggest_replies

## DUPĂ CE CLIENTUL ALEGE O VARIANTĂ SAU CONFIRMĂ
Indiferent cum ai prezentat variantele (chips, listă în text, sau ambele), când clientul răspunde cu:
- O mărime ("S", "M", "38", "W29 L32") — flow de selectare variantă
- O confirmare ("Da, adaugă", "Da", "OK", "Adaugă", "Yes") — flow de confirmare add la varianta unică
- Un nume de variantă/culoare ("Negru", "Alb", "Roșu") — același flow
- Orice răspuns scurt care pare o alegere de variantă (un singur caracter, un singur cuvânt scurt) — același flow

PAȘI OBLIGATORII (în acest mesaj, nu amâna):
1. **TOTDEAUNA apelează get_product_details PRIMA în acest mesaj** — chiar dacă crezi că-ți aduci aminte SKU-urile variantelor din mesajele anterioare, NU îți aduci. Tool result-urile din turnurile anterioare NU sunt în contextul tău acum — refetch e obligatoriu, nu opțional. Apelarea costă <100ms.
   - productId: caută în istoricul recent linia "Vreau X (SKU referință: Y)..." SAU în propriul tău mesaj anterior unde ai discutat produsul (numele produsului, codul de produs). Apelează get_product_details(Y).
2. Din output-ul get_product_details, copiază EXACT SKU-ul variantei alese (din linia "SKU XXXXX: ...").
3. Apelează **add_to_cart** cu acel SKU.
4. Confirmă în text bazat pe rezultatul add_to_cart.
5. **CRITIC: Dacă în acest turn NU vezi un tool result de la get_product_details, NU AI VOIE să afirmi nimic despre variantele disponibile. Ori apelezi tool-ul, ori ceri clientului să clarifice. NU FABRICA variante.**

CRITIC: niciodată nu inventa un SKU prin offset numeric (ex: productId+5) sau prin alăturarea variantei (ex: productId_M). VTEX assignează SKU-urile variantelor în ordine internă, NU previzibilă. Doar SKU-urile returnate explicit de get_product_details sunt valide.

NICIODATĂ:
- Nu răspunde gol/silent — clientul a confirmat o acțiune, EXECUT-O.
- Nu spune "am adăugat" fără add_to_cart real cu SKU valid.
- Nu cere clientului să "apese din nou pe card" — TU rezolvi cu get_product_details + add_to_cart.`
}

// ─── Tool Executor ──────────────────────────────────────────────

async function executeTool(
  ctx: Context,
  toolCall: LLMToolCall,
  orderFormId: string | null,
  config: ClientConfig,
  messages: LLMMessage[],
  userMessage: string
): Promise<ToolEffect> {
  const args = toolCall.arguments

  // Issue 03 — try the AgentTool registry first; fall through to the
  // legacy switch when the tool isn't migrated yet. The 3 AP2 ceremony
  // tools (create_cart_mandate, execute_payment, redirect_to_native_checkout)
  // live behind this dispatch.
  const agentEffect = await dispatchAgentTool(toolCall.name, args, {
    vtex: ctx.vtex,
    clients: ctx.clients,
    config,
    orderFormId,
  })

  if (agentEffect !== null) {
    return agentEffect
  }

  switch (toolCall.name) {
    case 'search_products': {
      const query = args.query as string
      const limit = (args.limit as number) || 4

      let currency = 'RON'

      try {
        if (orderFormId) {
          const of = await ctx.clients.checkout.getOrderForm(orderFormId)

          currency = of.storePreferencesData?.currencyCode || 'RON'
        }
      } catch {
        // Use default
      }

      // Over-fetch from RAG so we have headroom to drop results contradicting
      // the query's qualifiers (e.g. "lung" query but result name says "scurt").
      // Semantic search ranks the noun heavily and ignores the modifier; we
      // re-rank by post-filtering the obvious contradictions.
      const overFetch = Math.max(limit * 3, 12)
      const ragResult = await semanticSearch(ctx, query, overFetch, {
        available: true,
      })

      let productCards: ChatResponse['products']
      let summary: string

      if (!ragResult.fallback && ragResult.results.length > 0) {
        // Drop results whose name directly contradicts a qualifier in the query.
        // Semantic search underweights modifiers like "lung" / "elegant" — when
        // the noun matches strongly, the modifier barely affects ranking. We
        // post-filter to enforce the user's intent.
        const filtered = applyQualifierFilter(query, ragResult.results, (m) =>
          String(m.metadata?.name || '')
        )

        const trimmed = filtered.slice(0, limit)
        const droppedCount = ragResult.results.length - filtered.length

        if (droppedCount > 0) {
          console.log(
            `[ACG Chat] qualifier filter dropped ${droppedCount} contradicting results for query "${query}"`
          )
        }

        // Semantic search found results
        productCards = trimmed.map((match) => {
          const meta = match.metadata || {}
          const linkText = String(meta.linkText || '')
          const url = linkText ? `/${linkText}/p` : '/'
          const onSale = Boolean(meta.onSale)
          const discountPct = Number(meta.discountPct || 0)

          return {
            productId: String(meta.sku || match.id),
            name: String(meta.name || 'Unknown'),
            imageUrl: String(meta.image || ''),
            price: Math.round(Number(meta.price || 0) * 100),
            listPrice:
              Number(meta.originalPrice || 0) > Number(meta.price || 0)
                ? Math.round(Number(meta.originalPrice) * 100)
                : undefined,
            discountPct: onSale ? discountPct : undefined,
            onSale: onSale || undefined,
            currency,
            url,
            groupLabel: query,
          }
        })

        summary = trimmed
          .map((match) => {
            const meta = match.metadata || {}
            const onSale = Boolean(meta.onSale)
            const discountPct = Number(meta.discountPct || 0)
            const original = Number(meta.originalPrice || 0)
            const priceStr =
              onSale && discountPct > 0
                ? `${meta.price} ${currency} (on sale, was ${original} ${currency}, ${discountPct}% off)`
                : `${meta.price} ${currency}`

            return `- ${meta.name} (SKU: ${
              meta.sku
            }) — ${priceStr} [relevance: ${(match.score * 100).toFixed(0)}%]${
              meta.available === false ? ' [OUT OF STOCK]' : ''
            }`
          })
          .join('\n')

        return {
          result: `Found ${trimmed.length} products via semantic search${
            droppedCount > 0
              ? ` (filtered ${droppedCount} contradicting "${query}")`
              : ''
          }:\n${summary}`,
          products: productCards,
        }
      }

      // Fallback: VTEX keyword search
      // Over-fetch so we still get `limit` in-stock items after filtering
      const vtexProductsRaw = await ctx.clients.search.searchProducts(
        query,
        limit * 2
      )

      const vtexProducts = vtexProductsRaw
        .filter((p) => {
          const offer = p.items?.[0]?.sellers?.[0]?.commertialOffer

          return (offer?.AvailableQuantity ?? 0) > 0
        })
        .slice(0, limit)

      const products = vtexProducts.map(mapProduct)

      if (products.length === 0) {
        return { result: `No products found for "${query}".` }
      }

      productCards = products.map((p, i) => {
        const vtexProduct = vtexProducts[i]
        const linkText = vtexProduct?.linkText || ''
        const url = linkText ? `/${linkText}/p` : '/'
        const onSale = Boolean(p.originalPrice && p.originalPrice > p.price)
        const discountPct = onSale
          ? Math.round(((p.originalPrice! - p.price) / p.originalPrice!) * 100)
          : undefined

        return {
          productId: p.sku,
          name: p.name,
          imageUrl: p.image || '',
          price: Math.round(p.price * 100),
          listPrice: p.originalPrice
            ? Math.round(p.originalPrice * 100)
            : undefined,
          discountPct,
          onSale: onSale || undefined,
          currency,
          url,
          groupLabel: query,
        }
      })

      summary = products
        .map((p) => {
          const onSale = p.originalPrice && p.originalPrice > p.price
          const discountPct = onSale
            ? Math.round(
                ((p.originalPrice! - p.price) / p.originalPrice!) * 100
              )
            : 0

          const priceStr = onSale
            ? `${p.price} ${currency} (on sale, was ${p.originalPrice} ${currency}, ${discountPct}% off)`
            : `${p.price} ${currency}`

          return `- ${p.name} (SKU: ${p.sku}) — ${priceStr}${
            !p.available ? ' [OUT OF STOCK]' : ''
          }`
        })
        .join('\n')

      return {
        result: `Found ${products.length} products:\n${summary}`,
        products: productCards,
      }
    }

    case 'get_product_details': {
      const sku = args.sku as string
      const product = await ctx.clients.search.getProductBySku(sku)

      if (!product) {
        return { result: `Product with SKU ${sku} not found.` }
      }

      const mapped = mapProduct(product)

      // List ALL variants (SKUs) so the LLM can present size/color choices
      const allItems = product.items ?? []
      const availableItems = allItems.filter((item) => {
        const offer = item.sellers?.[0]?.commertialOffer

        return (offer?.AvailableQuantity ?? 0) > 0
      })

      const variantLines = allItems.map((item) => {
        const offer = item.sellers?.[0]?.commertialOffer
        const available = (offer?.AvailableQuantity ?? 0) > 0
        const price = offer?.Price ?? 0

        return `  - SKU ${item.itemId}: "${
          item.nameComplete || item.name
        }" — ${price} RON ${available ? '(in stock)' : '(OUT OF STOCK)'}`
      })

      // Build a prescriptive action hint so the LLM can't ignore the variant check.
      // Derive clean variant labels (e.g. "Multicolor, 34") from the long VTEX
      // skuName format. We use the same suffix extraction as add_to_cart so the
      // labels are consistent across the conversation.
      const variantLabels = availableItems
        .map((item) =>
          extractVariantLabel(item.nameComplete || item.name || '')
        )
        .filter((label) => label.length > 0)

      let action: string

      const confirmationStyle = config.confirmationStyle ?? 'verbose'

      if (availableItems.length === 0) {
        action =
          'ACTION: Toate variantele sunt OUT OF STOCK. Anunță clientul onest că produsul nu e disponibil momentan și NU apela add_to_cart. Oferă alternative cu search_products.'
      } else if (availableItems.length === 1) {
        const only = availableItems[0]
        const onlyLabel = variantLabels[0] || 'variantă unică'

        if (confirmationStyle === 'verbose') {
          action = [
            `ACTION: O singură variantă disponibilă (SKU ${only.itemId}, ${onlyLabel}). NU apela add_to_cart încă — întreabă întâi clientul.`,
            'În schimb:',
            `  1. Răspunde clientului: "Acest produs e disponibil doar în ${onlyLabel}. Adaug în coș?"`,
            '  2. Apelează suggest_replies cu options = ["Da, adaugă", "Nu, caut altceva"]',
            `  3. După confirmare ("Da, adaugă"), apelează add_to_cart cu sku = "${only.itemId}" — variant SKU EXACT, NU productId-ul "SKU referință" din mesajul clientului.`,
            `  IMPORTANT: dacă mesajul clientului e DEJA o confirmare ("Da, adaugă" / "ok" / "adaugă"), SARI peste pașii 1-2 și apelează DIRECT add_to_cart cu sku = "${only.itemId}". NU apela suggest_replies a doua oară — nu repeta aceeași întrebare Da/Nu.`,
          ].join('\n')
        } else {
          action = `ACTION: O singură variantă disponibilă (SKU ${only.itemId}, ${onlyLabel}). Apelează add_to_cart cu sku = "${only.itemId}" direct (variant SKU EXACT, NU productId-ul "SKU referință"), apoi confirmă în text că ai adăugat varianta ${onlyLabel}.`
        }
      } else {
        const chips = variantLabels.slice(0, 4)
        const chipJson = JSON.stringify(chips)

        action = [
          `ACTION: Sunt ${availableItems.length} variante disponibile. NU apela add_to_cart acum.`,
          'În schimb:',
          '  1. Răspunde scurt clientului: "Alege mărimea/varianta preferată:" (în limba clientului)',
          `  2. Apelează suggest_replies cu options = ${chipJson}`,
          '  3. Așteaptă răspunsul clientului înainte de add_to_cart.',
        ].join('\n')
      }

      const details = [
        `Name: ${mapped.name}`,
        `Brand: ${mapped.brand || '-'}`,
        `Category: ${mapped.category || '-'}`,
        mapped.description ? `Description: ${mapped.description}` : null,
        '',
        `Variants (${variantLines.length} total, ${availableItems.length} in stock):`,
        ...variantLines,
        '',
        action,
      ]
        .filter(Boolean)
        .join('\n')

      return { result: details }
    }

    case 'add_to_cart': {
      const sku = args.sku as string
      const quantity = (args.quantity as number) || 1

      // Issue 0008 — block SKU fabrication via productId offset / hallucination.
      // Only fires when the user's last message looks like a confirmation
      // ("Da, adaugă", "OK", "prima", etc.) AND the SKU isn't one returned
      // by any get_product_details tool result this chat call.
      const validationError = validateAddToCart(sku, userMessage, messages)

      if (validationError) {
        console.warn(
          `[ACG Chat] add_to_cart blocked — SKU ${sku} not in valid set (issue 0008)`
        )

        return { result: validationError }
      }

      const cart = new Cart({ checkout: ctx.clients.checkout })
      const ofId = orderFormId || (await resolveOrderFormId(ctx, cart))

      try {
        const updated = await cart.addItem(ofId, sku, quantity)
        const addedItem = updated.items.find((item) => item.sku === sku)

        // addItem guarantees the item is present (else it throws ItemNotAddedError),
        // but TypeScript needs the narrowing.
        if (!addedItem) {
          throw new ItemNotAddedError(sku)
        }

        const fullName = addedItem.name
        const variantLabel = extractVariantLabel(fullName) || '(none detected)'
        // Short product name = first 60 chars before any underscore-noise
        const shortName = fullName.split(' - ')[0].slice(0, 80)

        return {
          result: [
            `Added ${quantity}x to cart.`,
            `Product: ${shortName}`,
            `Variant: ${variantLabel || '(none detected)'}`,
            `Cart total: ${updated.total} ${updated.currency} (${updated.itemCount} items).`,
            '',
            `CONFIRMATION: Răspunde clientului INCLUZÂND varianta. Exemplu: "Am adăugat ${shortName} ${
              variantLabel || ''
            } — total ${updated.total} ${updated.currency} ✓"`,
          ].join('\n'),
          cartUpdated: true,
        }
      } catch (err) {
        if (err instanceof InvalidSkuFormatError) {
          console.warn(
            `[ACG Chat] Rejecting suspicious SKU format: "${err.sku}"`
          )

          return {
            result: `ERROR: SKU "${err.sku}" e invalid. SKU-urile valide sunt itemId numeric (ex: "590551"), NU productId + variantă (ex: "588600_M"). ACTION: Apelează get_product_details(productId) pentru a vedea SKU-urile reale ale variantelor, apoi add_to_cart cu unul EXACT din lista returnată. NU construi SKU-uri.`,
          }
        }

        if (err instanceof ItemNotAddedError) {
          console.warn(`[ACG Chat] add_to_cart no-op for SKU "${err.sku}"`)

          return {
            result: [
              `ERROR: add_to_cart pentru SKU "${err.sku}" a eșuat — VTEX nu a recunoscut SKU-ul. Coșul e neschimbat.`,
              '',
              'CAUZĂ PROBABILĂ: ai inventat un SKU bazat pe pattern (offset numeric, productId + variantă, etc). SKU-urile VTEX NU sunt previzibile.',
              '',
              'ACTION OBLIGATORIE — execută în ACEST mesaj:',
              '  1. Caută în istoricul recent linia "Vreau X (SKU referință: Y)" — Y e productId-ul.',
              '  2. Apelează get_product_details(Y) ACUM, în acest mesaj.',
              '  3. Copiază SKU-ul EXACT al variantei alese (mărime/culoare) din output ("SKU XXXXX: ...").',
              '  4. Apelează add_to_cart cu acel SKU.',
              '  5. NU cere clientului să apese din nou — TU rezolvi.',
              '  6. NU spune "am adăugat" până când add_to_cart nu returnează succes.',
            ].join('\n'),
          }
        }

        if (err instanceof TransientCartError && err.code === 'ORD003') {
          return {
            result:
              'VTEX rates-and-benefits service is having a hiccup (ORD003). Tell the customer briefly that there was a temporary issue and ask them to try again in a few seconds. Do NOT retry add_to_cart in this turn.',
          }
        }

        if (err instanceof OrderFormSubstitutedError) {
          return {
            result: `ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.`,
          }
        }

        throw err
      }
    }

    case 'get_cart': {
      if (!orderFormId) {
        return {
          result: 'Your cart is empty. Try searching for some products!',
        }
      }

      const cart = new Cart({ checkout: ctx.clients.checkout })

      try {
        const snapshot = await cart.getCart(orderFormId)

        if (snapshot.items.length === 0) {
          return { result: 'Your cart is empty.' }
        }

        const workspace = ctx.vtex.workspace || 'master'
        const host =
          workspace === 'master'
            ? `${ctx.vtex.account}.myvtex.com`
            : `${workspace}--${ctx.vtex.account}.myvtex.com`

        const checkoutUrl = `https://${host}/checkout/?orderFormId=${orderFormId}#/cart`

        const cartPreview: CartPreviewData = {
          items: snapshot.items.map((i) => ({
            sku: i.sku,
            name: i.name,
            quantity: i.quantity,
            unitPrice: Math.round(i.unitPrice * 100),
            totalPrice: Math.round(i.totalPrice * 100),
            image: i.image ?? '',
          })),
          subtotal: Math.round(snapshot.subtotal * 100),
          total: Math.round(snapshot.total * 100),
          itemCount: snapshot.itemCount,
          currency: snapshot.currency,
          checkoutUrl,
        }

        const items = snapshot.items
          .map(
            (i) =>
              `- ${i.name} x${i.quantity} — ${i.totalPrice} ${snapshot.currency}`
          )
          .join('\n')

        const status = [
          snapshot.hasShippingAddress
            ? 'Shipping address: set'
            : 'Shipping address: not set',
          snapshot.isReadyForCheckout
            ? 'Ready for checkout'
            : 'Not ready for checkout yet',
        ].join('\n')

        return {
          result: `Cart (${snapshot.itemCount} items):\n${items}\nSubtotal: ${snapshot.subtotal} ${snapshot.currency}\nTotal: ${snapshot.total} ${snapshot.currency}\n${status}\n\nThe cart UI is rendered for the customer. Do not re-list items in your reply — just briefly note the total and suggest next steps.`,
          cartPreview,
        }
      } catch (err) {
        if (err instanceof OrderFormSubstitutedError) {
          return {
            result: `ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.`,
          }
        }

        throw err
      }
    }

    case 'remove_from_cart': {
      if (!orderFormId) {
        return { result: 'Cart is already empty.' }
      }

      const sku = args.sku as string
      const cart = new Cart({ checkout: ctx.clients.checkout })

      try {
        const updated = await cart.removeBySku(orderFormId, sku)

        return {
          result: `Item removed. Cart now has ${updated.itemCount} items, total: ${updated.total} ${updated.currency}.`,
          cartUpdated: true,
        }
      } catch (err) {
        if (err instanceof ItemNotInCartError) {
          return { result: `SKU ${err.sku} not found in cart.` }
        }

        if (err instanceof OrderFormSubstitutedError) {
          return {
            result: `ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.`,
          }
        }

        throw err
      }
    }

    case 'update_cart_quantity': {
      if (!orderFormId) {
        return { result: 'Cart is empty. Add items first.' }
      }

      const sku = args.sku as string
      const quantity = args.quantity as number
      const cart = new Cart({ checkout: ctx.clients.checkout })

      try {
        const updated = await cart.setQuantity(orderFormId, sku, quantity)

        return {
          result: `Updated quantity. Cart now has ${updated.itemCount} items, total: ${updated.total} ${updated.currency}.`,
          cartUpdated: true,
        }
      } catch (err) {
        if (err instanceof InvalidSkuFormatError) {
          return {
            result: `ERROR: SKU "${err.sku}" e invalid. SKU-urile valide sunt itemId numeric. ACTION: Apelează get_cart pentru a vedea SKU-urile reale din coș.`,
          }
        }

        if (err instanceof ItemNotInCartError) {
          return { result: `SKU ${err.sku} not found in cart.` }
        }

        if (err instanceof OrderFormSubstitutedError) {
          return {
            result: `ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.`,
          }
        }

        throw err
      }
    }

    case 'apply_coupon': {
      if (!orderFormId) {
        return {
          result: 'Cart is empty. Add items first before applying a coupon.',
        }
      }

      const code = args.code as string
      const cart = new Cart({ checkout: ctx.clients.checkout })

      try {
        const { cart: updated, applied, reason } = await cart.applyCoupon(
          orderFormId,
          code
        )

        if (applied) {
          return {
            result: updated.discount
              ? `Coupon "${code}" applied! You saved ${updated.discount} ${updated.currency}. New total: ${updated.total} ${updated.currency}.`
              : `Coupon "${code}" applied. Total: ${updated.total} ${updated.currency}.`,
            cartUpdated: true,
          }
        }

        // Soft outcome — coupon accepted by VTEX but no discount was produced.
        return {
          result: `Coupon "${code}" was registered but no discount was applied${
            reason ? ` (${reason})` : ''
          }. Tell the customer the code didn't reduce the total and suggest they check eligibility or try another code.`,
          cartUpdated: true,
        }
      } catch (err) {
        if (err instanceof OrderFormSubstitutedError) {
          return {
            result: `ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.`,
          }
        }

        // Hard failure from VTEX — usually means the code itself was rejected.
        return { result: `Coupon "${code}" is not valid or has expired.` }
      }
    }

    case 'set_customer_profile': {
      const cart = new Cart({ checkout: ctx.clients.checkout })
      const ofId = orderFormId || (await resolveOrderFormId(ctx, cart))

      const profileData = {
        email: args.email as string,
        firstName: args.firstName as string,
        lastName: args.lastName as string,
        phone: (args.phone as string) || '',
      }

      try {
        await cart.setCustomerProfile(ofId, profileData)

        return {
          result: `Customer profile set for ${profileData.firstName} ${profileData.lastName} (${profileData.email}).`,
          cartUpdated: true,
        }
      } catch (err) {
        if (err instanceof OrderFormSubstitutedError) {
          return {
            result: `ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.`,
          }
        }

        throw err
      }
    }

    case 'set_shipping_address': {
      const cart = new Cart({ checkout: ctx.clients.checkout })
      const ofId = orderFormId || (await resolveOrderFormId(ctx, cart))

      try {
        await cart.setShippingAddress(ofId, {
          street: args.street as string,
          number: args.number as string,
          city: args.city as string,
          state: args.state as string,
          postalCode: args.postalCode as string,
          country: args.country as string,
          complement: (args.complement as string) || '',
          ...(typeof args.neighborhood === 'string' && args.neighborhood
            ? { neighborhood: args.neighborhood }
            : {}),
        })

        return {
          result: `Shipping address set to ${args.street} ${args.number}, ${args.city}, ${args.postalCode}.`,
          cartUpdated: true,
        }
      } catch (err) {
        if (err instanceof OrderFormSubstitutedError) {
          return {
            result: `ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.`,
          }
        }

        throw err
      }
    }

    case 'get_shipping_options': {
      if (!orderFormId) {
        return { result: 'Add items and set a shipping address first.' }
      }

      const cart = new Cart({ checkout: ctx.clients.checkout })

      try {
        const shippingOptions = await cart.getShippingOptions(orderFormId)

        if (shippingOptions.length === 0) {
          return {
            result:
              'No shipping options available. Make sure you have set a shipping address.',
          }
        }

        const lines = shippingOptions.map((opt) => {
          const daysMatch = (opt.estimatedDelivery || '').replace(/[^\d]/g, '')
          const days = daysMatch ? parseInt(daysMatch, 10) : 0

          return `- ${opt.name}: ${
            opt.price > 0 ? `${opt.price} RON` : 'FREE'
          } (${days} business days)`
        })

        const unique = [...new Set(lines)]

        return { result: `Shipping options:\n${unique.join('\n')}` }
      } catch (err) {
        if (err instanceof OrderFormSubstitutedError) {
          return {
            result: `ERROR: cart session was reset by VTEX. Ask the customer to refresh and try again.`,
          }
        }

        throw err
      }
    }

    case 'propose_deal': {
      if (!orderFormId) {
        return { result: 'Cart is empty. No deals to suggest.' }
      }

      const orderForm = await ctx.clients.checkout.getOrderForm(orderFormId)
      const cart = mapOrderFormToCart(orderForm)

      if (cart.items.length === 0) {
        return { result: 'Cart is empty. No deals to suggest.' }
      }

      const suggestions: string[] = []

      // Free shipping threshold
      const freeShippingThreshold = 200

      if (
        cart.total < freeShippingThreshold &&
        cart.total >= freeShippingThreshold * 0.5
      ) {
        const needed = freeShippingThreshold - cart.total

        suggestions.push(
          `Add ${needed.toFixed(2)} ${cart.currency} more for FREE shipping!`
        )
      }

      // Quantity discount hint
      if (cart.items.length === 1 && cart.items[0].quantity === 1) {
        suggestions.push(
          `Buy 2 of "${cart.items[0].name}" and you might qualify for a bulk discount.`
        )
      }

      // Bundle suggestion
      if (cart.items.length >= 2) {
        suggestions.push(
          'You have multiple items — check if a bundle deal is available at checkout.'
        )
      }

      if (suggestions.length === 0) {
        return {
          result: `Your cart looks good at ${cart.total} ${cart.currency}. No additional deals found right now.`,
        }
      }

      return {
        result: `Deal suggestions:\n${suggestions
          .map((s) => `- ${s}`)
          .join('\n')}`,
      }
    }

    // The legacy `case 'checkout'` block was deleted by Issue 03 — its
    // logic is now split across three AgentTools under
    // `node/agent-tools/`: create_cart_mandate, execute_payment,
    // redirect_to_native_checkout. The dispatcher at the top of this
    // function routes to them via the registry before falling through.

    case 'check_order_status': {
      const orderId = args.orderId as string

      try {
        const order = await ctx.clients.checkout.getOrder(orderId)

        const status = order.status || 'unknown'
        const total = order.value ? (order.value / 100).toFixed(2) : 'N/A'

        return {
          result: `Order ${orderId}:\nStatus: ${status}\nTotal: ${total}\nCreated: ${
            order.creationDate || 'N/A'
          }`,
        }
      } catch {
        return {
          result: `Order ${orderId} not found or you don't have access to view it.`,
        }
      }
    }

    case 'suggest_replies': {
      const options = Array.isArray(args.options)
        ? (args.options as unknown[])
            .filter((o): o is string => typeof o === 'string')
            .slice(0, 4)
        : []

      if (options.length === 0) {
        return { result: 'No suggestions provided.' }
      }

      return {
        result: `Quick-reply chips attached: ${options.join(' | ')}`,
        suggestions: options,
      }
    }

    default:
      return { result: `Unknown tool: ${toolCall.name}` }
  }
}

// ─── LLM Factory ────────────────────────────────────────────────

function createLLMClient(ctx: Context, settings: AppSettings) {
  const provider = settings.llmProvider || 'claude'

  if (provider === 'openai') {
    if (!settings.openaiApiKey) {
      throw new Error(
        'OpenAI API key not configured. Go to Admin > Apps > ACG Adapter settings.'
      )
    }

    const model = settings.openaiModel || 'gpt-4o-mini'

    console.log(`[ACG LLM] provider=openai model=${model}`)

    return new OpenAIClient(ctx.vtex, {
      apiKey: settings.openaiApiKey,
      model: settings.openaiModel,
    })
  }

  if (provider === 'gemini') {
    if (!settings.geminiApiKey) {
      throw new Error(
        'Gemini API key not configured. Go to Admin > Apps > ACG Adapter settings.'
      )
    }

    const model = settings.geminiModel || 'gemini-2.5-flash'

    console.log(`[ACG LLM] provider=gemini model=${model}`)

    return new GeminiClient(ctx.vtex, {
      apiKey: settings.geminiApiKey,
      model: settings.geminiModel,
    })
  }

  // Default: Claude
  if (!settings.claudeApiKey) {
    throw new Error(
      'Claude API key not configured. Go to Admin > Apps > ACG Adapter settings.'
    )
  }

  const model = settings.claudeModel || 'claude-haiku-4-5-20251001'

  console.log(`[ACG LLM] provider=claude model=${model}`)

  return new ClaudeClient(ctx.vtex, {
    apiKey: settings.claudeApiKey,
    model: settings.claudeModel,
  })
}

// ─── Cost Controls ──────────────────────────────────────────────

// Rough token estimation (1 token ≈ 4 chars for English, ~3 for Romanian)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

// Trim conversation history to fit within budget
function trimHistory(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number
): Array<{ role: 'user' | 'assistant'; content: string }> {
  // Always keep at least the last 2 messages (1 user + 1 assistant turn)
  const MAX_MESSAGES = 8 // Hard cap: last 8 messages
  let trimmed = history.slice(-MAX_MESSAGES)

  // Further trim if token budget exceeded
  let totalTokens = trimmed.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  )

  while (totalTokens > maxTokens && trimmed.length > 2) {
    trimmed = trimmed.slice(1)
    totalTokens = trimmed.reduce((sum, m) => sum + estimateTokens(m.content), 0)
  }

  return trimmed
}

// Truncate tool results to avoid blowing up context
function truncateToolResult(result: string, maxChars = 1500): string {
  if (result.length <= maxChars) return result

  return `${result.slice(0, maxChars)}... [truncated]`
}

/**
 * Pairs of mutually-exclusive qualifiers in the catalog vocabulary. If the
 * search query contains one side, results whose name contains the other side
 * are dropped — semantic search ranks the noun heavily and barely respects
 * these modifiers. Generic across fashion, electronics, etc.
 *
 * Stored as a single regex per side so we can extend by adding entries.
 */
const QUALIFIER_OPPOSITES: Array<[RegExp, RegExp]> = [
  // length: lung / lungă / lungi / lunge  vs  scurt / scurtă / scurți / scurte
  [/\blung[aăeiî]?\b/i, /\bscurt[aăeiî]?\b/i],
  // formality
  [/\belegant[aăeiî]?\b/i, /\bsport(iv[aăeiî]?)?\b/i],
  // season
  [/\bvar[aă]\b/i, /\biarn[aă]\b/i],
  // sleeve length (multi-word phrases)
  [/\bm[aâ]nec[aăeiî] lung[aăeiî]\b/i, /\bf[aă]r[aă] m[aâ]nec[ai]\b/i],
  // color tone
  [/\bdeschis[aăeiî]?\b/i, /\b[iî]nchis[aăeiî]?\b/i],
]

/**
 * Drop results whose name contradicts a qualifier present in the query.
 * Returns the list with offenders removed, preserving original order.
 */
function applyQualifierFilter<T>(
  query: string,
  results: T[],
  getName: (item: T) => string
): T[] {
  // Determine which "forbidden" patterns apply based on the query
  const forbidden: RegExp[] = []

  for (const [a, b] of QUALIFIER_OPPOSITES) {
    if (a.test(query)) forbidden.push(b)
    if (b.test(query)) forbidden.push(a)
  }

  if (forbidden.length === 0) return results

  return results.filter((item) => {
    const name = getName(item)

    return !forbidden.some((re) => re.test(name))
  })
}

/**
 * Extract a clean, human-readable variant label from VTEX's long skuName format.
 *
 * Examples (miniprix-style):
 *   "Pantaloni Dama T 25KKW02O55 25KKW02O55_PANTALONI - DAMA - Multicolor_34"
 *     → "Multicolor, 34"
 *   "Cercei eleganti M01A0123_GENTI - DAMA - UNICA"
 *     → "varianta unică"
 *   "Bluza N250720016 N250720016191_BLUZA - DAMA - Rosu_S"
 *     → "Rosu, S"
 *
 * Strategy: take the segment after the last " - " (or the whole name if no " - "),
 * split by "_", drop any token that looks like an internal SKU code (6+
 * uppercase/digit chars), join the rest with ", ".
 */
function extractVariantLabel(fullName: string): string {
  if (!fullName) return ''

  const lastSep = fullName.lastIndexOf(' - ')
  const suffix =
    lastSep >= 0 ? fullName.slice(lastSep + 3).trim() : fullName.trim()

  if (!suffix) return ''

  const parts = suffix
    .split('_')
    .map((p) => p.trim())
    .filter(Boolean)

  const cleaned = parts.filter((p) => !/^[A-Z0-9]{6,}$/.test(p))

  if (cleaned.length === 0 || cleaned.every((p) => /^unica$/i.test(p))) {
    return 'varianta unică'
  }

  return cleaned.join(', ')
}

// ─── Issue 0008: SKU-fabrication guard ────────────────────────────
//
// The LLM occasionally calls add_to_cart with a SKU it computed from
// productId (e.g. productId - 1) instead of one returned by
// get_product_details. VTEX SKU IDs are sequential, so the fabricated
// SKU lands on a real but unrelated product (e.g. customer asks for
// shoes, gets socks). This guard enforces the invariant: the SKU passed
// to add_to_cart MUST be one that some get_product_details tool result
// surfaced in this chat call.

// Exported (alongside PILL/PAY_NOW below) for the mutual-exclusion unit
// test in handlers/__tests__ — the test imports the REAL regexes so it
// can't drift from what the handler uses.
export const CONFIRMATION_REGEX = /^\s*(da|yes|ok(ay)?|adaug[ăa]?|sigur|confirm|prima|a doua|a treia|primul|al doilea|al treilea)\b/i

// ─── Pay-Now gate regexes (widget checkout) ───────────────────────
//
// PILL_REGEX matches the canned turn the widget sends when the customer
// taps a payment-method pill: "Plătesc cu Cash (id: 47)". tryPayNow
// Phase A intercepts it, sets the chosen method as the SOLE payment, and
// returns an order REVIEW (no placement).
//
// PAY_NOW_REGEX matches the explicit Pay-Now turn the widget sends when
// the customer taps the "Plătește acum" chip on that review. tryPayNow
// Phase B runs the real place → send → authorize sequence.
//
// These three regexes (PILL, PAY_NOW, CONFIRMATION) are MUTUALLY
// EXCLUSIVE by construction — a unit test asserts no representative
// string matches more than one. "Plătesc cu …" (pill) starts with the
// 1st-person form; "Plătește acum" (Pay-Now) with the imperative; neither
// is matched by CONFIRMATION_REGEX (which keys on da/yes/ok/adaugă/…).
export const PILL_REGEX = /Pl[aă]te[sșz]c cu .* \(id:\s*(\d+)\)/i
export const PAY_NOW_REGEX = /^\s*(pl[aă]te[sșz]te acum|pay now|__pay_now__)\b/i

// In-process placement lock, keyed by orderFormId. Held for the WHOLE
// place → send → authorize sequence and released in `finally`. This is the
// idempotency guard for Phase B: it must NOT rely on readOrderFormState
// (the memoization-poisoned VBase read this whole feature exists to route
// around). A second Pay-Now for the same cart while one is in flight — or
// after one already placed — short-circuits to an "already placed" reply.
const placedOrderForms = new Set<string>()
const inFlightPayNow = new Set<string>()

function extractValidSkuSet(messages: LLMMessage[]): Set<string> {
  const skus = new Set<string>()
  const skuPattern = /\bSKU\s+(\d+)/g

  for (const m of messages) {
    if (!m.toolResults) continue
    for (const tr of m.toolResults) {
      if (tr.name !== 'get_product_details') continue
      let match: RegExpExecArray | null

      while ((match = skuPattern.exec(tr.result)) !== null) {
        skus.add(match[1])
      }
    }
  }

  return skus
}

/**
 * Returns null if add_to_cart is allowed, or an ERROR string to surface
 * as the tool result if the SKU looks fabricated. Only fires when the
 * user's last message looks like a confirmation/short pick (the failure
 * mode we observed). Free-form requests like "add SKU 593657" pass
 * through unblocked.
 */
function validateAddToCart(
  sku: string,
  userMessage: string,
  messages: LLMMessage[]
): string | null {
  if (!CONFIRMATION_REGEX.test(userMessage.trim())) {
    return null
  }

  const validSkus = extractValidSkuSet(messages)

  if (validSkus.has(sku)) {
    return null
  }

  return [
    `ERROR: SKU ${sku} is not a valid variant of any product in this conversation.`,
    `Valid SKUs come from get_product_details tool results — not from prior conversation history`,
    `(those tool results are NOT in your context now).`,
    ``,
    `To recover: identify the productId of the product the customer is asking about`,
    `(look for "SKU referință: <productId>" in the user's message, or a product code in`,
    `the prior search result). Call get_product_details(<productId>), copy the EXACT SKU`,
    `of the variant the customer chose from its output ("SKU XXXXX: <variant>"), then`,
    `call add_to_cart with that SKU.`,
    ``,
    `Do NOT compute SKUs by adding/subtracting from a productId — VTEX assigns SKU IDs`,
    `internally; offsets land on unrelated products.`,
  ].join('\n')
}

/**
 * Deterministic confirmation loop-breaker — the load-bearing fix for the
 * single-variant add-to-cart loop.
 *
 * Symptom: customer clicks a product card, the agent asks "Adaug în coș?",
 * the customer says "Da, adaugă" — and the agent asks again, forever. Root
 * cause: across HTTP requests prior tool results are stripped, the prompt
 * re-forces get_product_details on every confirm turn, and its single-variant
 * ACTION always says "ask first" with no "already confirmed" branch — so a
 * weak model (Haiku) re-emits suggest_replies and the cart never mutates.
 *
 * This runs BEFORE the LLM. If the latest message is an affirmative and we can
 * recover the just-clicked product (from the "SKU referință: Y" card line) and
 * it has exactly ONE buyable variant NOT already in the cart, we add it
 * server-side and return a confirmation directly — the model never runs on this
 * turn, so it cannot skip the add or re-ask. Returns null (fall through to the
 * normal loop) for every other case: free-form text, multi-variant size choice,
 * out-of-stock, or an item already in the cart (where a "Da" confirms checkout,
 * not a re-add — this also prevents double-adds on a double-click).
 */
async function tryConfirmationAutoAdd(
  ctx: Context,
  body: ChatRequest,
  orderFormId: string | null | undefined
): Promise<ChatResponse | null> {
  if (!CONFIRMATION_REGEX.test(body.message.trim())) {
    return null
  }

  // Recover the productId from the most recent "Vreau X (SKU referință: Y)"
  // card-click line in history. No anchor → let the model handle it.
  const history = body.history ?? []
  let productId: string | undefined

  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]

    if (m.role !== 'user') continue

    const match = /SKU referin\S*:\s*(\d+)/i.exec(m.content)

    if (match) {
      productId = match[1]
      break
    }
  }

  if (!productId) {
    console.log(
      `[ACG Chat] confirmation: "${body.message.trim()}" matched but no "SKU referință" anchor in history — deferring to LLM`
    )

    return null
  }

  const product = await ctx.clients.search
    .getProductBySku(productId)
    .catch((err) => {
      console.warn(
        `[ACG Chat] confirmation: getProductBySku(${productId}) threw:`,
        err instanceof Error ? err.message : err
      )

      return null
    })

  if (!product) {
    console.log(
      `[ACG Chat] confirmation: getProductBySku(${productId}) returned nothing — deferring to LLM`
    )

    return null
  }

  const variants = product.items ?? []
  const availableItems = variants.filter((item) => {
    const offer = item.sellers?.[0]?.commertialOffer

    return (offer?.AvailableQuantity ?? 0) > 0
  })

  const cart = new Cart({ checkout: ctx.clients.checkout })
  const ofId = orderFormId || (await resolveOrderFormId(ctx, cart))
  const productName = product.productName || 'produsul'

  console.log(
    `[ACG Chat] confirmation: productId=${productId} "${productName}" variants=${variants.length} inStock=${availableItems.length}`
  )

  // No buyable variant — fail FAST and honestly instead of letting the model
  // loop add_to_cart against an unsellable SKU. One clean reply beats a
  // 4-round loop that ends in a "VTEX has a problem" message.
  if (availableItems.length === 0) {
    console.warn(
      `[ACG Chat] confirmation: "${productName}" (productId ${productId}) has no buyable variant — replying unavailable`
    )

    return {
      reply: `Din păcate ${productName} nu e disponibil în stoc momentan, așa că nu îl pot adăuga în coș. Vrei să caut o alternativă?`,
      suggestions: ['Caută alt produs'],
    }
  }

  // The customer confirmed "add it" — so ADD, don't interrogate. For a
  // MULTI-VARIANT product we default to the first in-stock variant instead of
  // bouncing to the weak model for a size/colour question (which just loops
  // "Aștept răspunsul tău" forever). A reliable add beats an endless "which
  // size?" exchange; precise variant selection is a later refinement.
  const target = availableItems[0]

  // If that variant is already in the cart, INCREMENT its quantity (VTEX's
  // POST /items is a silent no-op on re-add, so we update by index instead of
  // re-adding). Otherwise add it fresh.
  const rawForm = await ctx.clients.checkout
    .getOrderForm(ofId)
    .catch(() => null)

  const existingIndex =
    rawForm?.items?.findIndex((i) => i.id === target.itemId) ?? -1

  let updated: ReturnType<typeof mapOrderFormToCart> | null

  if (rawForm && existingIndex >= 0) {
    const currentQty = rawForm.items[existingIndex].quantity ?? 1

    console.log(
      `[ACG Chat] confirmation: SKU ${
        target.itemId
      } already in cart (qty ${currentQty}) → incrementing to ${currentQty + 1}`
    )

    const bumped = await ctx.clients.checkout
      .updateItems(ofId, [{ index: existingIndex, quantity: currentQty + 1 }])
      .catch((err) => {
        console.warn(
          `[ACG Chat] confirmation increment failed for SKU ${target.itemId}:`,
          err instanceof Error ? err.message : err
        )

        return null
      })

    updated = bumped ? mapOrderFormToCart(bumped) : null
  } else {
    console.log(
      `[ACG Chat] confirmation: adding SKU ${target.itemId} (new line) to cart`
    )

    updated = await cart.addItem(ofId, target.itemId, 1).catch((err) => {
      console.warn(
        `[ACG Chat] confirmation auto-add failed for SKU ${target.itemId}:`,
        err instanceof Error ? err.message : err
      )

      return null
    })
  }

  // VTEX refused the add (no-op / inactive SKU). Fail fast + honest, no loop.
  if (!updated) {
    return {
      reply: `Nu am putut adăuga ${productName} în coș — VTEX nu acceptă acest produs momentan (poate fi epuizat sau dezactivat). Vrei să caut o alternativă?`,
      suggestions: ['Caută alt produs'],
    }
  }

  const added = updated.items.find((i) => i.sku === target.itemId)
  const fullName = added?.name ?? productName
  const variantLabel = extractVariantLabel(fullName)
  const shortName = fullName.split(' - ')[0].slice(0, 80)

  const workspace = ctx.vtex.workspace || 'master'
  const host =
    workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`

  const checkoutUrl = `https://${host}/checkout/?orderFormId=${ofId}#/cart`

  const cartPreview: CartPreviewData = {
    items: updated.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPrice: Math.round(i.unitPrice * 100),
      totalPrice: Math.round(i.totalPrice * 100),
      image: i.image ?? '',
    })),
    subtotal: Math.round(updated.subtotal * 100),
    total: Math.round(updated.total * 100),
    itemCount: updated.itemCount,
    currency: updated.currency,
    checkoutUrl,
  }

  console.log(
    `[ACG Chat] confirmation auto-add: SKU ${target.itemId} (productId ${productId}) — cart now ${updated.itemCount} items`
  )

  return {
    reply: `Am adăugat ${shortName}${
      variantLabel ? ` (${variantLabel})` : ''
    } în coș — total ${updated.total} ${
      updated.currency
    }. Continuăm cumpărăturile sau mergem la plată?`,
    cartPreview,
    cartUpdated: true,
    suggestions: ['Continuă cumpărăturile', 'Mergem la plată'],
  }
}

// ─── Pay-Now gate orchestrator (widget checkout) ──────────────────
//
// This is the code-enforced fix for the widget checkout. Background: in
// the widget path the chat handler runs every checkout tool in ONE HTTP
// request sharing one @vtex/api HttpClient memoization cache (keyed by URL,
// no write-invalidation). So place_order's early getOrderForm / vbase reads
// get memoized; its later writes don't bust them; send_payment_info /
// authorize_transaction then re-read STALE data and bail "no open
// transaction". The fix is to (a) never re-read VBase between steps —
// thread the just-placed transaction IN MEMORY via CheckoutState — and (b)
// run place → send → authorize as one server-side sequence gated behind an
// explicit Pay-Now click. The MCP/iframe path is untouched: it drives the
// chain across SEPARATE requests, so its VBase reads settle naturally.
//
// Two phases, switched on body.message:
//   Phase A (PILL_REGEX)    — a payment method was tapped. Override the
//                             payment (clear → set → verify sole), check
//                             place_order's preconditions, return an order
//                             REVIEW + a single Pay-Now chip. NO placement.
//   Phase B (PAY_NOW_REGEX) — the Pay-Now chip was tapped. Run the real
//                             place → send → authorize sequence and return
//                             the merged mandate so the widget renders its
//                             PlacedOrderConfirmation.
// Returns null (fall through to the LLM loop) for every other message.
async function tryPayNow(
  ctx: Context,
  body: ChatRequest,
  orderFormId: string | null | undefined,
  config: ClientConfig
): Promise<ChatResponse | null> {
  const message = body.message.trim()
  const isPill = PILL_REGEX.test(message)
  const isPayNow = PAY_NOW_REGEX.test(message)

  // Not our turn — let the LLM loop handle it.
  if (!isPill && !isPayNow) {
    return null
  }

  // Guards mirror tryConfirmationAutoAdd: no cart → fall through.
  if (!orderFormId) {
    return null
  }

  const cart = new Cart({ checkout: ctx.clients.checkout })
  const currentCart = await cart.getCart(orderFormId).catch(() => null)

  if (!currentCart || currentCart.items.length === 0) {
    return null
  }

  if (isPayNow) {
    return payNowPhaseB(ctx, orderFormId, config)
  }

  // Phase A — payment-pill canned turn: "Plătesc cu Cash (id: 47)".
  const match = PILL_REGEX.exec(message)
  const chosenId = match?.[1]

  if (!chosenId) {
    return null
  }

  return payNowPhaseA(ctx, orderFormId, chosenId, config)
}

/**
 * Phase A — a payment method was chosen. Make it the SOLE payment
 * (clear-then-set, then verify), check the profile + shipping preconditions
 * place_order enforces, and return an order REVIEW (no placement) plus a
 * single Pay-Now chip. Missing profile/shipping returns a question instead.
 */
async function payNowPhaseA(
  ctx: Context,
  orderFormId: string,
  chosenId: string,
  config: ClientConfig
): Promise<ChatResponse | null> {
  const cart = new Cart({ checkout: ctx.clients.checkout })

  // Resolve the chosen method's label/group from the merchant's configured
  // systems so the review (and Pay-Now path) shows a real name. Soft — a
  // missing label is cosmetic. The chosen id is looked up against the FULL
  // list (it came from a curated pill, but be defensive); the pills we
  // surface on any retry are the CURATED set (profile allowlist + order).
  const allMethods = await cart
    .getAvailablePaymentSystems(orderFormId)
    .catch(() => [] as Awaited<ReturnType<Cart['getAvailablePaymentSystems']>>)

  const chosen = allMethods.find((m) => m.id === chosenId)
  const paymentMethods: PaymentMethodOption[] = curatePaymentMethods(
    allMethods,
    config
  ).map((m) => ({
    id: m.id,
    name: m.name,
    group: m.group,
    requiresAuthentication: m.requiresAuthentication,
  }))

  // ── Payment override = REPLACE, not append, verified off the POST echo. ──
  //
  // Real VTEX APPENDS to paymentData.payments, so simply "setting" the new
  // method can leave a stale prior payment behind (→ split-pay / value
  // mismatch / the wrong method authorizing). setSolePayment clears then
  // sets and returns the AUTHORITATIVE post-write orderForm straight off the
  // POST response. We verify against THAT — never a follow-up getOrderForm,
  // which @vtex/api memoizes against this request's earlier reads and would
  // return a stale, pre-write form (the bug that made the first pay-method
  // tap spuriously fail "couldn't fix the method as the sole option" while
  // an identical second tap passed).
  let orderForm: VTEXOrderForm

  try {
    orderForm = await cart.setSolePayment(orderFormId, chosenId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    if (/not configured/.test(msg)) {
      return {
        reply:
          'Metoda de plată aleasă nu este disponibilă pe acest magazin. Alege altă metodă.',
        paymentMethods,
      }
    }

    console.warn(
      `[ACG Chat] tryPayNow Phase A: payment override failed: ${msg}`
    )

    return {
      reply:
        'Nu am putut seta metoda de plată. Mai încearcă o dată sau alege altă metodă.',
      paymentMethods,
    }
  }

  // Assert the chosen method is the SOLE payment, reading the authoritative
  // POST echo (never a memoized GET). If it isn't, surface a clear error.
  const verifyPayments = (orderForm.paymentData?.payments ?? []) as Array<
    Record<string, unknown>
  >

  if (
    verifyPayments.length !== 1 ||
    String(verifyPayments[0].paymentSystem) !== chosenId
  ) {
    console.warn(
      `[ACG Chat] tryPayNow Phase A: payment not sole after override — ` +
        `count=${verifyPayments.length} systems=[${verifyPayments
          .map((p) => String(p.paymentSystem))
          .join(',')}] expected=${chosenId}`
    )

    return {
      reply:
        'Nu am putut fixa metoda de plată ca unică opțiune pe coș. Mai încearcă o dată.',
      paymentMethods,
    }
  }

  // ── Preconditions place_order enforces (profile email + shipping). ──
  // If either is missing, ASK for it here — never place a half-ready order.

  if (!orderForm.clientProfileData?.email) {
    return {
      reply:
        'Înainte de plată am nevoie de datele tale de contact (nume și email). Le poți completa?',
      paymentMethods,
    }
  }

  const hasShipping =
    !!orderForm.shippingData?.address ||
    (orderForm.shippingData?.selectedAddresses?.length ?? 0) > 0

  if (!hasShipping) {
    return {
      reply: 'Înainte de plată am nevoie de adresa de livrare. O poți adăuga?',
      paymentMethods,
    }
  }

  // ── Build the order review (no placement) off the SAME authoritative
  // form — no fresh getCart (it would memoize-collide with the writes above).
  const snapshot = mapOrderFormToCart(orderForm)
  const totalCents = Math.round(snapshot.total * 100)
  const currency =
    snapshot.currency ?? orderForm.storePreferencesData.currencyCode

  const cartPreview = buildCartPreview(ctx, orderFormId, snapshot)

  const methodName = chosen?.name ?? `Method ${chosenId}`
  const totalLabel = (totalCents / 100).toFixed(2)

  // Success review: render the OrderReviewCard ONLY. We deliberately omit
  // `paymentMethods` (the 17 pills — the customer already chose) and the
  // `suggestions: ['Plătește acum']` chip (the card carries its own Pay-Now
  // button); both were redundant clutter / a double Pay-Now control.
  return {
    reply: `Comanda ta: total ${totalLabel} ${currency}, plată cu ${methodName}. Apasă "Plătește acum" ca să confirmi.`,
    cartPreview,
    orderReview: {
      customerProfile: formatCustomerProfile(orderForm),
      shippingAddress: formatShippingAddress(orderForm),
      selectedPayment: {
        id: chosenId,
        name: methodName,
        group: chosen?.group,
      },
      total: totalCents,
      currency,
    },
  }
}

/**
 * Phase B — the Pay-Now chip was tapped. Run place → send → authorize as
 * one server-side sequence, threading CheckoutState in memory (never
 * re-reading VBase between steps). Idempotent via an in-process lock.
 */
async function payNowPhaseB(
  ctx: Context,
  orderFormId: string,
  config: ClientConfig
): Promise<ChatResponse> {
  // ── Idempotency guard (NOT based on the poisoned VBase read). ──
  if (placedOrderForms.has(orderFormId)) {
    console.log(
      `[ACG Chat] tryPayNow Phase B: order already placed for ${orderFormId} — replying idempotent`
    )

    return {
      reply: 'Comanda a fost deja plasată. Mandatul AP2 confirmă cumpărătura.',
    }
  }

  if (inFlightPayNow.has(orderFormId)) {
    console.log(
      `[ACG Chat] tryPayNow Phase B: a placement is already in flight for ${orderFormId} — replying busy`
    )

    return {
      reply:
        'Comanda ta este în curs de procesare. Te rog așteaptă câteva secunde.',
    }
  }

  inFlightPayNow.add(orderFormId)

  try {
    // ToolContext exactly as executeTool builds it.
    const toolCtx: ToolContext = {
      vtex: ctx.vtex,
      clients: ctx.clients,
      config,
      orderFormId,
    }

    console.log(`[ACG Chat] tryPayNow Phase B: place_order for ${orderFormId}`)
    const placeEffect = await placeOrderTool.execute({}, toolCtx)

    if (placeEffect.result.startsWith('ERROR')) {
      console.warn(
        `[ACG Chat] tryPayNow Phase B: place_order failed — ${placeEffect.result}`
      )

      return { reply: placeEffect.result }
    }

    // Mark placed only once the order really exists in VTEX. From here on a
    // repeat Pay-Now is idempotent even if send/authorize hiccup.
    placedOrderForms.add(orderFormId)

    const checkoutState = placeEffect.checkoutState as CheckoutState | undefined

    if (!checkoutState) {
      // place_order succeeded but didn't surface CheckoutState — this should
      // not happen. Don't fall back to the poisoned VBase read; report the
      // placement and let the merchant verify rather than silently mis-send.
      console.warn(
        `[ACG Chat] tryPayNow Phase B: place_order returned no checkoutState — skipping send/authorize`
      )

      return {
        reply: 'Comanda a fost plasată. Mandatul AP2 confirmă cumpărătura.',
        mandate: placeEffect.mandate,
        cartPreview: placeEffect.cartPreview,
      }
    }

    // ── send_payment_info + authorize_transaction with injected state. ──
    // Thread CheckoutState via a PRIVATE ToolContext field (NOT the shared
    // args bag the LLM populates) so both tools route around the
    // memoization-poisoned VBase read while staying unreachable from a
    // model-supplied argument on the LLM tool surface.
    const sequencedCtx: ToolContext = {
      ...toolCtx,
      injectedCheckoutState: checkoutState,
    }

    console.log(
      `[ACG Chat] tryPayNow Phase B: send_payment_info (injected state) for ${orderFormId}`
    )
    const sendEffect = await sendPaymentInfoTool.execute({}, sequencedCtx)

    if (sendEffect.result.startsWith('ERROR')) {
      console.warn(
        `[ACG Chat] tryPayNow Phase B: send_payment_info failed — ${sendEffect.result}`
      )
    }

    console.log(
      `[ACG Chat] tryPayNow Phase B: authorize_transaction (injected state) for ${orderFormId}`
    )
    const authEffect = await authorizeTransactionTool.execute({}, sequencedCtx)

    // Merge place_order's full mandate with authorize's mandatePatch (mirrors
    // the chat handler's accumulator merge).
    let { mandate } = placeEffect

    if (authEffect.mandatePatch && mandate) {
      mandate = { ...mandate, ...authEffect.mandatePatch }
    }

    console.log(
      `[ACG Chat] tryPayNow Phase B: done for ${orderFormId} — gatewayStatus=${
        mandate?.gatewayStatus ?? '<none>'
      }`
    )

    return {
      reply: 'Gata, comanda este plasată. Mandatul AP2 confirmă cumpărătura.',
      mandate,
      cartPreview: placeEffect.cartPreview,
    }
  } finally {
    inFlightPayNow.delete(orderFormId)
  }
}

/**
 * Build a cents-denominated CartPreview from a SimpleCart, matching the
 * shape tryConfirmationAutoAdd emits (unit/total prices in cents, checkout
 * URL keyed on the workspace host).
 */
function buildCartPreview(
  ctx: Context,
  orderFormId: string,
  snapshot: ReturnType<typeof mapOrderFormToCart>
): CartPreviewData {
  const workspace = ctx.vtex.workspace || 'master'
  const host =
    workspace === 'master'
      ? `${ctx.vtex.account}.myvtex.com`
      : `${workspace}--${ctx.vtex.account}.myvtex.com`

  const checkoutUrl = `https://${host}/checkout/?orderFormId=${orderFormId}#/cart`

  return {
    items: snapshot.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPrice: Math.round(i.unitPrice * 100),
      totalPrice: Math.round(i.totalPrice * 100),
      image: i.image ?? '',
    })),
    subtotal: Math.round(snapshot.subtotal * 100),
    total: Math.round(snapshot.total * 100),
    itemCount: snapshot.itemCount,
    currency: snapshot.currency,
    checkoutUrl,
  }
}

// Detect when the LLM claims a cart action it didn't actually perform.
// Haiku-class models occasionally fabricate "Am adăugat..." messages without
// firing add_to_cart. This catches that and triggers a corrective round.
function detectCartHallucination(
  text: string,
  didAdd: boolean,
  didRemove: boolean,
  calledTools: string[]
): { violated: boolean; reason: string } {
  const lower = text.toLowerCase()

  // Romanian + English add patterns. Excludes "voi adăuga" / "să adaug" (future/intent).
  // Catches: "am adăugat", "X adăugată în coș", "Added to cart", "X is in your cart"
  const addPatterns = [
    /\bam ad[aă]ugat\b/i,
    /\bad[aă]ugat[aă]?\b[^.!?\n]{0,40}\bîn co[șs]\b/i,
    /\bad[aă]ugat[aă]?\s+în co[șs]\b/i,
    /\badded to (?:cart|the cart)\b/i,
    /\b(?:produsul|articolul|piesa) e (?:acum )?(?:în|in) co[șs]\b/i,
  ]

  const removePatterns = [
    /\bam scos\b/i,
    /\bam [șs]ters\b/i,
    /\bscos\s+din co[șs]\b/i,
    /\b[șs]ters\s+din co[șs]\b/i,
    /\bremoved from (?:cart|the cart)\b/i,
  ]

  const claimsAdd = addPatterns.some((p) => p.test(lower))
  const claimsRemove = removePatterns.some((p) => p.test(lower))

  if (claimsAdd && !didAdd) {
    return {
      violated: true,
      reason: `LLM said "added" but no add_to_cart tool was called (tools: ${
        calledTools.join(',') || 'none'
      })`,
    }
  }

  if (claimsRemove && !didRemove) {
    return {
      violated: true,
      reason: `LLM said "removed" but no remove_from_cart/update was called (tools: ${
        calledTools.join(',') || 'none'
      })`,
    }
  }

  return { violated: false, reason: '' }
}

/**
 * Detect product-listing hallucination — the LLM emitted text listing
 * specific products (with SKUs or bulleted prices) WITHOUT having called
 * search_products in this chat turn.
 *
 * Live test on 2026-05-11 captured the failure mode: user asked for
 * "less floral" alternatives; the LLM mentally filtered (couldn't —
 * everything was floral) and hallucinated 4 new products with plausible
 * SKUs from the same numeric range. No tool call = no product cards
 * with images get rendered = user sees a plain text list of items that
 * may or may not even exist.
 *
 * Detection signals (any one is enough):
 *   - 2+ "SKU: nnnnnn" references in text without search_products called
 *   - 3+ bulleted lines each ending in a price (RON/EUR/USD/etc.)
 *     without search_products called
 *
 * False-positive guard: we only trigger if text length > 200 chars.
 * Short replies like "want to add the floral one?" won't trip it.
 */
function detectProductListingHallucination(
  text: string,
  calledTools: string[]
): { violated: boolean; reason: string } {
  if (!text || text.length < 200) {
    return { violated: false, reason: '' }
  }

  if (calledTools.includes('search_products')) {
    return { violated: false, reason: '' }
  }

  // SKU references — explicit "SKU: 565804" style or "(SKU 565804)" style.
  const skuRefs = (text.match(/SKU\s*:?\s*\d{4,}/gi) || []).length

  if (skuRefs >= 2) {
    return {
      violated: true,
      reason: `text lists ${skuRefs} SKU references without calling search_products`,
    }
  }

  // Multiple bulleted product lines each with a price — typical
  // "here are 4 options at X RON" hallucinated list shape.
  const bulletWithPrice = (
    text.match(
      /(?:^|\n)\s*(?:[*\-•]|\d+\.)\s+[^\n]{8,200}?\b(?:RON|EUR|USD|\$|€|lei)\b/gim
    ) || []
  ).length

  if (bulletWithPrice >= 3) {
    return {
      violated: true,
      reason: `text lists ${bulletWithPrice} bulleted products with prices without calling search_products`,
    }
  }

  return { violated: false, reason: '' }
}

/**
 * Scan the conversation for gender signals to determine if a gender has
 * already been established for this session.
 *
 * Counts hits across user messages, assistant messages, AND tool results
 * (product names / category breadcrumbs like "Damă > Fuste" reveal the
 * gender as effectively as an explicit user statement). Returns the
 * dominant gender if it has at least 2 hits — single mentions are too
 * weak to lock in (could be a passing reference or a typo).
 */
function extractEstablishedGender(
  messages: LLMMessage[]
): 'damă' | 'bărbați' | 'copil' | null {
  const damaPattern = /\b(dam[aă]|femei|feminin|woman|women|fust[aă]|rochi[aei])\b/i
  const barbatiPattern = /\b(b[aă]rba[tț]i?|man|men|blazer\s+cu\s+cravat[aă])\b/i
  const copilPattern = /\b(copil(ul|i)?|kids?|children|b[aă]ie[tț]el|feti[tț][aă])\b/i

  let damaScore = 0
  let barbatiScore = 0
  let copilScore = 0

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : ''

    if (damaPattern.test(content)) damaScore++
    if (barbatiPattern.test(content)) barbatiScore++
    if (copilPattern.test(content)) copilScore++

    // Tool results often have category breadcrumbs ("Damă > Fuste") and
    // product names with gender markers ("Fustă petrecută") that are the
    // strongest signals of all.
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        const txt = typeof tr.result === 'string' ? tr.result : ''

        if (damaPattern.test(txt)) damaScore++
        if (barbatiPattern.test(txt)) barbatiScore++
        if (copilPattern.test(txt)) copilScore++
      }
    }
  }

  const ranked = [
    { gender: 'damă' as const, score: damaScore },
    { gender: 'bărbați' as const, score: barbatiScore },
    { gender: 'copil' as const, score: copilScore },
  ].sort((a, b) => b.score - a.score)

  // Min 2 hits AND a clear lead over the runner-up (avoid flip-flop
  // sessions where the user shopped for both genders).
  if (ranked[0].score >= 2 && ranked[0].score > ranked[1].score) {
    return ranked[0].gender
  }

  return null
}

/**
 * Detect gender re-ask: the LLM emitted a "Pentru bărbați sau damă?"-style
 * clarification question even though the conversation already established
 * a gender via earlier searches / cart contents / user statements.
 *
 * Same class as detectProductListingHallucination — a prompt-rule that
 * the model ignored. The corrective round inlines the established gender
 * so the next response uses it directly.
 *
 * Only triggers when:
 *   - Established gender is known (extractEstablishedGender returned non-null)
 *   - Reply text is short (gender questions are typically < 80 chars)
 *   - Text matches a gender-question pattern
 */
function detectGenderReAskHallucination(
  text: string,
  establishedGender: string | null
): { violated: boolean; reason: string } {
  if (!establishedGender) return { violated: false, reason: '' }
  if (!text || text.length > 200) return { violated: false, reason: '' }

  const genderQuestionPatterns = [
    /pentru\s+(?:b[ăa]rba[tț]i|dam[ăa])\s+sau\s+(?:dam[ăa]|b[ăa]rba[tț]i)/i,
    /dam[ăa]\s+sau\s+b[ăa]rba[tț]i/i,
    /pentru\s+ce\s+gen/i,
    /men\s+or\s+women/i,
    // Gender-clarification suggest_replies textual fallback ("Bărbați? Damă?")
    /\bb[ăa]rba[tț]i\s*\?\s*dam[ăa]/i,
    /\bdam[ăa]\s*\?\s*b[ăa]rba[tț]i/i,
  ]

  if (genderQuestionPatterns.some((p) => p.test(text))) {
    return {
      violated: true,
      reason: `LLM asked for gender clarification but session already established gender as "${establishedGender}"`,
    }
  }

  return { violated: false, reason: '' }
}

// ─── Token Budget Constants ─────────────────────────────────────

const TOKEN_BUDGET = {
  systemPrompt: 400, // ~400 tokens for system prompt
  history: 1500, // ~1500 tokens for conversation history
  toolResults: 1500, // ~1500 tokens for tool results per round
  maxResponseTokens: 512, // Max LLM output tokens per call
  maxTotalInput: 4000, // Hard cap on total input tokens
}

// ─── Main Handler ───────────────────────────────────────────────

export async function chatHandler(ctx: Context) {
  try {
    const body = (await json(ctx.req)) as ChatRequest

    if (!body.message) {
      ctx.status = 400
      ctx.body = { error: 'Missing "message" field' }

      return
    }

    // Reject excessively long messages
    if (body.message.length > 2000) {
      ctx.status = 400
      ctx.body = {
        error: 'Message too long. Please keep messages under 2000 characters.',
      }

      return
    }

    // Get app settings
    const settings: AppSettings = await ctx.clients.apps
      .getAppSettings('vtexeurope.acg-adapter')
      .catch(() => ({}))

    // Create LLM client
    let llm: ClaudeClient | OpenAIClient | GeminiClient

    try {
      llm = createLLMClient(ctx, settings)
    } catch (error) {
      ctx.status = 500
      ctx.body = {
        error: error instanceof Error ? error.message : 'LLM not configured',
      }

      return
    }

    // Build conversation with cost controls
    const orderFormId = body.orderFormId || getOrderFormIdFromRequest(ctx)
    const config = loadConfigForAccount(ctx.vtex.account || '')

    const messages: LLMMessage[] = [
      { role: 'system', content: buildSystemPrompt(config) },
    ]

    // Trim history to fit token budget
    if (body.history) {
      const trimmed = trimHistory(body.history, TOKEN_BUDGET.history)

      for (const msg of trimmed) {
        messages.push({ role: msg.role, content: msg.content })
      }
    }

    // Add current message
    messages.push({ role: 'user', content: body.message })

    // ── Deterministic confirmation loop-breaker (runs BEFORE the LLM). ──
    // If the customer just confirmed ("Da, adaugă") a single-variant product
    // they clicked, add it server-side and return now. The weak model can no
    // longer skip the add or re-ask, because it never runs on this turn.
    // Falls through (null) for every other case — see tryConfirmationAutoAdd.
    const autoAdded = await tryConfirmationAutoAdd(ctx, body, orderFormId)

    if (autoAdded) {
      ctx.body = autoAdded

      return
    }

    // ── Pay-Now gate (runs BEFORE the LLM). ──
    // Phase A: a payment pill was tapped → set the method as sole payment
    // and return an order review (no placement). Phase B: the Pay-Now chip
    // was tapped → run place → send → authorize server-side with in-memory
    // CheckoutState. The intercept is authoritative; the LLM never runs the
    // checkout-placement tools on the widget path. Falls through (null) for
    // every other message — see tryPayNow.
    const payNow = await tryPayNow(ctx, body, orderFormId, config)

    if (payNow) {
      ctx.body = payNow

      return
    }

    // Call LLM (with tool loop — max 3 rounds)
    // Accumulate products across tool calls (dedup by productId, keep first occurrence)
    const productMap = new Map<string, ProductCardData>()
    let suggestions: string[] | undefined
    let cartPreview: CartPreviewData | undefined
    let mandate: MandateInfo | undefined
    let paymentMethods: PaymentMethodOption[] | undefined
    let cartUpdated = false
    let addedSuccessfully = false
    let removedSuccessfully = false
    const calledTools: string[] = []
    // Round budget for the LLM tool loop. 4 is the empirical sweet spot:
    // a fully-loaded checkout turn legitimately needs (1) get_product_details
    // (2) suggest_replies for variant (3) add_to_cart (4) confirm. At 3 we
    // were exhausting on every single-variant add path. At 5+ models drift
    // into unnecessary follow-up tool spam.
    const MAX_TOOL_ROUNDS = 4

    // Track the most recent non-empty assistant text across rounds.
    // Gemini sometimes returns empty content in later rounds when it already
    // said its piece earlier — use the last meaningful text as final reply.
    let lastAssistantText = ''

    // Merge the legacy switch-based CHAT_TOOLS with the new AgentTool
    // registry definitions (Issue 03). The LLM sees them as one list.
    const allTools: LLMTool[] = [...CHAT_TOOLS, ...getAgentToolDefinitions()]

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response: LLMResponse = await llm.chat(
        messages,
        allTools,
        TOKEN_BUDGET.maxResponseTokens
      )

      console.log(
        `[ACG Chat] Round ${round} — text:${
          response.content?.length ?? 0
        }c toolCalls:${response.toolCalls.length} finishReason:${
          response.finishReason
        }`
      )

      if (response.content && response.content.trim().length > 0) {
        lastAssistantText = response.content
      }

      // No tool calls — we have the final answer (or a hallucinated/empty one)
      if (response.toolCalls.length === 0) {
        // Use this round's text if available, else fall back to whatever we
        // captured in earlier rounds (Gemini after-tool quiet-turn case).
        const finalText = response.content?.trim()
          ? response.content
          : lastAssistantText

        // EMPTY RESPONSE GUARD — Gemini sometimes returns text:0 toolCalls:0
        // on confirmation messages ("Da, adaugă") because it can't decide what
        // to add without re-reading the conversation. One corrective round
        // usually unblocks it.
        const isEmpty = !response.content?.trim() && !lastAssistantText
        const userMessageLooksLikeConfirmation = /^\s*(da|yes|ok(ay)?|adaug[ăa]?|sigur|confirm)\b/i.test(
          body.message
        )

        if (isEmpty && round < MAX_TOOL_ROUNDS - 1) {
          console.warn(
            '[ACG Chat] Empty response detected — forcing corrective round'
          )
          messages.push({ role: 'assistant', content: '(no response)' })
          messages.push({
            role: 'user',
            content: userMessageLooksLikeConfirmation
              ? `[SYSTEM] Tu ai răspuns gol. Mesajul anterior al clientului ("${body.message}") e o confirmare la propunerea ta de a adăuga un produs. Caută în istoric SKU-ul produsului discutat (în mesajul "Vreau X (SKU referință: Y)..." sau în get_product_details anterior), apelează add_to_cart cu acel SKU și confirmă în text. NU mai răspunde gol.`
              : '[SYSTEM] Tu ai răspuns gol. Trebuie să răspunzi clientului — fie cu text, fie cu un tool call. Recitește mesajul clientului și execută acțiunea potrivită.',
          })
          continue
        }

        const guard = detectCartHallucination(
          finalText,
          addedSuccessfully,
          removedSuccessfully,
          calledTools
        )

        if (guard.violated && round < MAX_TOOL_ROUNDS - 1) {
          // The LLM claimed a cart action it didn't actually perform.
          // Push a corrective system note and let it run another round to do the real call.
          console.warn(
            `[ACG Chat] Hallucination detected — ${
              guard.reason
            }. Forcing correction round ${round + 1}.`
          )
          messages.push({ role: 'assistant', content: finalText })
          messages.push({
            role: 'user',
            content: `[SYSTEM CORRECTION] Răspunsul tău anterior a spus că ai adăugat/scos un produs, DAR nu ai apelat tool-ul corespunzător în acest mesaj. Asta e o halucinare gravă. Tools apelate până acum: ${
              calledTools.join(', ') || '(niciunul)'
            }. Apelează ACUM tool-ul corect (add_to_cart sau remove_from_cart cu SKU-ul exact), apoi confirmă bazat pe rezultatul lui. NU repeta răspunsul fabricat.`,
          })
          continue
        }

        // Product-listing hallucination — LLM listed specific products
        // in text without ever calling search_products. The widget would
        // render the message as plain text (no product cards, no images,
        // no add-to-cart buttons). Force the LLM to actually search.
        const productGuard = detectProductListingHallucination(
          finalText,
          calledTools
        )

        if (productGuard.violated && round < MAX_TOOL_ROUNDS - 1) {
          console.warn(
            `[ACG Chat] Product-listing hallucination — ${
              productGuard.reason
            }. Forcing search round ${round + 1}.`
          )
          messages.push({ role: 'assistant', content: finalText })
          messages.push({
            role: 'user',
            content: `[SYSTEM CORRECTION] Ai listat produse specifice (cu SKU-uri / prețuri) în text DAR nu ai apelat search_products în această tură. Asta înseamnă că produsele sunt FABRICATE — nu există dovadă că sunt în catalog. Apelează ACUM search_products cu o interogare rafinată bazată pe ultimul mesaj al clientului (adaugă calificative ca "non-floral", "abstract", "uni" etc.). Apoi răspunde bazat STRICT pe rezultatele tool-ului. NU repeta lista fabricată.`,
          })
          continue
        }

        // Gender re-ask hallucination — the LLM asked "Pentru bărbați
        // sau damă?" despite the conversation having already established
        // a gender (via prior searches, cart contents, or explicit user
        // statements). Prompt rule alone isn't enough; force a corrective
        // round that inlines the established gender.
        const establishedGender = extractEstablishedGender(messages)
        const genderGuard = detectGenderReAskHallucination(
          finalText,
          establishedGender
        )

        if (genderGuard.violated && round < MAX_TOOL_ROUNDS - 1) {
          console.warn(
            `[ACG Chat] Gender re-ask hallucination — ${
              genderGuard.reason
            }. Forcing search round ${round + 1}.`
          )
          messages.push({ role: 'assistant', content: finalText })
          messages.push({
            role: 'user',
            content: `[SYSTEM CORRECTION] Ai întrebat genul din nou, DAR sesiunea asta a stabilit deja că vorbim despre "${establishedGender}" (vezi căutările anterioare / coș / context). NU MAI ÎNTREBA. Apelează DIRECT search_products cu interogarea clientului plus genul "${establishedGender}" inclus (ex: dacă clientul vrea "cămașă", caută "cămașă ${establishedGender}"; dacă vrea "pantofi", caută "pantofi ${establishedGender}"). Apoi răspunde bazat STRICT pe rezultatele tool-ului.`,
          })
          continue
        }

        // Localize the fallback to match the merchant's default locale.
        // Picks up strings.errorConnection from the active config.
        const fallbackText =
          config.strings[config.locales.default]?.errorConnection ??
          "I'm sorry, I couldn't generate a response."

        const reply = finalText || fallbackText

        console.log(
          `[ACG Chat] Final reply (round ${round}, ${
            reply.length
          }c): ${reply.slice(0, 120)}${reply.length > 120 ? '...' : ''}`
        )

        ctx.body = {
          reply,
          products: productMap.size > 0 ? [...productMap.values()] : undefined,
          suggestions,
          cartPreview,
          cartUpdated,
          mandate,
          paymentMethods,
        } as ChatResponse

        return
      }

      // Push the assistant turn — text + structured tool calls.
      // Claude/OpenAI clients use only `content`; GeminiClient uses `toolCalls`.
      // Anthropic rejects empty content — fall back to a tiny placeholder when
      // the model returned only tool calls without text.
      if (response.content || response.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content || '(calling tools)',
          toolCalls:
            response.toolCalls.length > 0 ? response.toolCalls : undefined,
        })
      }

      // Collect tool results for this round so we can emit them as a single
      // structured user turn (matches Gemini's expected functionResponse shape).
      const roundToolResults: Array<{ name: string; result: string }> = []

      for (const toolCall of response.toolCalls) {
        console.log(
          `[ACG Chat] Tool call: ${toolCall.name}`,
          JSON.stringify(toolCall.arguments)
        )
        calledTools.push(toolCall.name)

        try {
          const toolResult = await executeTool(
            ctx,
            toolCall,
            orderFormId,
            config,
            messages,
            body.message
          )

          // Only count cart actions as successful if the tool didn't return
          // an ERROR result. Otherwise the hallucination guard would skip
          // catching the LLM saying "I added it" when the add actually failed.
          const wasError = toolResult.result.startsWith('ERROR')

          if (toolCall.name === 'add_to_cart' && !wasError) {
            addedSuccessfully = true
          } else if (
            (toolCall.name === 'remove_from_cart' ||
              toolCall.name === 'update_cart_quantity') &&
            !wasError
          ) {
            removedSuccessfully = true
          }

          if (toolResult.products) {
            for (const p of toolResult.products) {
              // First occurrence wins — preserves the label of the search that found it
              if (!productMap.has(p.productId)) {
                productMap.set(p.productId, p)
              }
            }
          }

          if (toolResult.cartUpdated) {
            cartUpdated = true
          }

          if (toolResult.suggestions && toolResult.suggestions.length > 0) {
            // Later calls win — if Claude refines chips across turns
            suggestions = toolResult.suggestions
          }

          if (toolResult.cartPreview) {
            // Latest wins — cart state after most-recent tool
            cartPreview = toolResult.cartPreview
          }

          if (toolResult.mandate) {
            // Full envelope from create_cart_mandate / place_order.
            mandate = toolResult.mandate
          }

          if (toolResult.mandatePatch && mandate) {
            // Partial overlay (e.g. authorize_transaction adding
            // gatewayStatus). Only merge when we already have a full
            // mandate — patches without a base are dropped since the
            // widget can't render half a badge.
            mandate = { ...mandate, ...toolResult.mandatePatch }
          }

          if (toolResult.paymentMethods) {
            // Latest call wins — if the user removes / adds items
            // mid-flow the merchant's available methods can shift.
            paymentMethods = toolResult.paymentMethods
          }

          roundToolResults.push({
            name: toolCall.name,
            result: truncateToolResult(toolResult.result),
          })
        } catch (error) {
          console.error(`[ACG Chat] Tool error: ${toolCall.name}`, error)
          roundToolResults.push({
            name: toolCall.name,
            result: `ERROR: ${
              error instanceof Error ? error.message : 'Unknown error'
            }`,
          })
        }
      }

      // Emit a single user turn carrying all tool results from this round.
      // Text content is the legacy bracketed format Claude/OpenAI consume;
      // GeminiClient ignores it and uses `toolResults` instead.
      if (roundToolResults.length > 0) {
        const textBlocks = roundToolResults
          .map((tr) => `[Tool result for ${tr.name}]: ${tr.result}`)
          .join('\n\n')

        messages.push({
          role: 'user',
          content: textBlocks,
          toolResults: roundToolResults,
        })
      }
    }

    // If we exhausted tool rounds, ask once more for a final text-only response
    console.warn('[ACG Chat] Exhausted MAX_TOOL_ROUNDS — requesting final text')
    const finalResponse = await llm.chat(
      messages,
      [],
      TOKEN_BUDGET.maxResponseTokens
    )

    const fallbackText =
      config.strings[config.locales.default]?.errorConnection ??
      "I've looked into that for you. Is there anything else I can help with?"

    // Strip the internal "(calling tools)" placeholder if the model echoed
    // it back as text (it was meant as a non-empty stand-in for an
    // assistant turn that only carried tool calls — not user-facing text).
    const sanitizeFinal = (text: string | null | undefined): string | null => {
      if (!text) return null
      const cleaned = text
        .replace(/\(calling tools\)/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim()

      return cleaned.length > 0 ? cleaned : null
    }

    const finalText =
      sanitizeFinal(finalResponse.content) ||
      sanitizeFinal(lastAssistantText) ||
      fallbackText

    console.log(
      `[ACG Chat] Final reply (${finalText.length}c): ${finalText.slice(
        0,
        120
      )}${finalText.length > 120 ? '...' : ''}`
    )

    ctx.body = {
      reply: finalText,
      products: productMap.size > 0 ? [...productMap.values()] : undefined,
      suggestions,
      cartPreview,
      cartUpdated,
      mandate,
    } as ChatResponse
  } catch (error) {
    console.error('[ACG Chat] Error:', error)
    ctx.status = 500
    ctx.body = {
      error: 'Chat failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
