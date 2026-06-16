/**
 * vtex-headless-probe — drive the full VTEX headless checkout flow.
 *
 * Each step here mirrors one network call the adapter makes. The script
 * is intentionally dumb: vanilla axios, no abstractions, no MCP, no VTEX
 * IO routing. It exists so we can see EXACTLY what VTEX returns at each
 * step, fix bugs against the real contract, then port the corrections
 * back to the adapter.
 *
 * If anything fails, the script aborts loudly with the request URL,
 * body, response status, and response body. That is the entire point —
 * never again "Response shape unexpected" with no context.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import axios, { AxiosError, AxiosInstance, AxiosResponse } from 'axios'

// ────────────────────────────────────────────────────────────────────────
// Tiny .env loader so we don't pull in a dependency for one feature.

function loadDotenv(path: string): void {
  if (!existsSync(path)) return
  const txt = readFileSync(path, 'utf8')
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

loadDotenv(join(__dirname, '.env'))

// ────────────────────────────────────────────────────────────────────────
// Config

const ACCOUNT = required('VTEX_ACCOUNT')
const SKU = required('SKU')
const EMAIL = required('EMAIL')
const PAYMENT_SYSTEM_ID = process.env.PAYMENT_SYSTEM_ID ?? '47'
const APP_KEY = process.env.VTEX_APP_KEY ?? ''
const APP_TOKEN = process.env.VTEX_APP_TOKEN ?? ''

// Defaults proven to resolve to a non-empty geoCoordinates in the
// vtexeurope merchant's RO postal-code DB (see the reference order at
// compares/1638520533612-01.json). Bucharest CEPs like "010101" are not
// in the DB and VTEX silently returns geoCoordinates=[] for them, which
// produces a divergence with the reference. Override via .env if you
// want to test a different shape; just confirm the CEP exists in the
// merchant's RO data first.
const SHIPPING = {
  postalCode: process.env.POSTAL_CODE ?? '417571',
  city: process.env.CITY ?? 'Adoni',
  state: process.env.STATE ?? 'BIHOR',
  country: process.env.COUNTRY ?? 'ROU',
  street: process.env.STREET ?? 'nucilor',
  number: process.env.NUMBER ?? '2',
  neighborhood: process.env.NEIGHBORHOOD,
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing required env var: ${name}. See .env.example.`)
    process.exit(1)
  }
  return v
}

// ────────────────────────────────────────────────────────────────────────
// HTTP clients

const checkoutBase = `https://${ACCOUNT}.vtexcommercestable.com.br`
// paymentsBase is filled in from step 7's `receiverUri`, falling back to
// the conventional vtexpayments host if the response omits it.
let paymentsBase = `https://${ACCOUNT}.vtexpayments.com.br`

const checkout: AxiosInstance = axios.create({
  baseURL: checkoutBase,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'vtex-headless-probe/0.0.1',
  },
  // Validate every status ourselves so we can log non-2xx and stop.
  validateStatus: () => true,
  timeout: 30000,
})

function paymentsClient(): AxiosInstance {
  return axios.create({
    baseURL: paymentsBase,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'vtex-headless-probe/0.0.1',
      ...(APP_KEY && APP_TOKEN
        ? {
            'X-VTEX-API-AppKey': APP_KEY,
            'X-VTEX-API-AppToken': APP_TOKEN,
          }
        : {}),
    },
    validateStatus: () => true,
    timeout: 30000,
  })
}

// ────────────────────────────────────────────────────────────────────────
// Trace log

interface TraceEntry {
  step: number
  label: string
  request: { method: string; url: string; body?: unknown }
  response: {
    status: number
    body: unknown
    durationMs: number
    relevantHeaders?: Record<string, string | undefined>
  }
}

const trace: TraceEntry[] = []
let stepCounter = 0

const RELEVANT_HEADERS = [
  'x-vtex-error-code',
  'x-vtex-error-message',
  'x-vtex-router-version',
  'x-request-id',
  'x-vtex-operation-id',
  'www-authenticate',
]

async function probe(
  label: string,
  client: AxiosInstance,
  config: {
    method: 'get' | 'post' | 'put'
    url: string
    body?: unknown
    extraHeaders?: Record<string, string>
  }
): Promise<unknown> {
  stepCounter += 1
  const fullUrl = `${client.defaults.baseURL ?? ''}${config.url}`
  const banner = `━━━ Step ${stepCounter}: ${label}`
  console.log(`\n${banner}`)
  console.log(`→ ${config.method.toUpperCase()} ${fullUrl}`)
  if (config.body !== undefined) {
    console.log(`  body: ${JSON.stringify(config.body)}`)
  }

  const started = Date.now()
  let res: AxiosResponse
  try {
    res = await client.request({
      method: config.method,
      url: config.url,
      data: config.body,
      headers: config.extraHeaders,
    })
  } catch (err) {
    const e = err as AxiosError
    const detail = e.response
      ? `status=${e.response.status} body=${JSON.stringify(e.response.data)}`
      : e.message
    abort(label, `${config.method.toUpperCase()} ${fullUrl}`, config.body, detail)
  }

  const elapsed = Date.now() - started
  const relevantHeaders: Record<string, string | undefined> = {}
  for (const h of RELEVANT_HEADERS) {
    const v = res.headers?.[h]
    if (v !== undefined) relevantHeaders[h] = String(v)
  }

  console.log(`← ${res.status} (${elapsed}ms)`)
  if (Object.keys(relevantHeaders).length > 0) {
    console.log(`  headers: ${JSON.stringify(relevantHeaders)}`)
  }
  // Truncate huge response bodies for stdout; the trace file has them whole.
  const bodyForConsole = JSON.stringify(res.data)
  console.log(
    `  body: ${
      bodyForConsole.length > 1500
        ? bodyForConsole.slice(0, 1500) + '… [+' + (bodyForConsole.length - 1500) + ' chars]'
        : bodyForConsole
    }`
  )

  trace.push({
    step: stepCounter,
    label,
    request: { method: config.method.toUpperCase(), url: fullUrl, body: config.body },
    response: {
      status: res.status,
      body: res.data,
      durationMs: elapsed,
      relevantHeaders,
    },
  })

  if (res.status >= 400) {
    abort(label, `${config.method.toUpperCase()} ${fullUrl}`, config.body, res.data)
  }

  // ORD009-style: 200 OK with a `messages[]` error payload.
  const data = res.data as { messages?: Array<{ code: string; text: string; status?: string }> }
  if (Array.isArray(data?.messages) && data.messages.some((m) => m.status === 'error')) {
    const summary = data.messages
      .map((m) => `${m.code}:${m.text}${m.status ? ` [${m.status}]` : ''}`)
      .join(' | ')
    abort(label, `${config.method.toUpperCase()} ${fullUrl}`, config.body, `messages error: ${summary}`)
  }

  return res.data
}

function abort(label: string, urlLine: string, body: unknown, detail: unknown): never {
  console.error(`\n✗ ABORT at "${label}"`)
  console.error(`  request: ${urlLine}`)
  if (body !== undefined) {
    console.error(`  request body: ${JSON.stringify(body, null, 2)}`)
  }
  console.error(`  failure: ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}`)
  writeTrace()
  process.exit(1)
}

function writeTrace(): void {
  const dir = join(__dirname, 'traces')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Date.now is fine here — this is an ad-hoc script, not a workflow.
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(trace, null, 2), 'utf8')
  console.log(`\nTrace written to ${file}`)
}

// ────────────────────────────────────────────────────────────────────────
// Helpers to dig into specific response shapes

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null

function getString(obj: unknown, ...keys: string[]): string | undefined {
  let cur: unknown = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return typeof cur === 'string' ? cur : undefined
}

function getArray(obj: unknown, ...keys: string[]): unknown[] | undefined {
  let cur: unknown = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[k]
  }
  return Array.isArray(cur) ? cur : undefined
}

// ────────────────────────────────────────────────────────────────────────
// Steps

async function main(): Promise<void> {
  console.log('vtex-headless-probe — starting')
  console.log(`  account=${ACCOUNT} sku=${SKU} email=${EMAIL} paymentSystemId=${PAYMENT_SYSTEM_ID}`)
  console.log(`  postal=${SHIPPING.postalCode} city=${SHIPPING.city}`)

  // STEP 1 — create orderForm
  const created = await probe('Create orderForm', checkout, {
    method: 'post',
    url: '/api/checkout/pub/orderForm',
  })
  const orderFormId = getString(created, 'orderFormId')
  if (!orderFormId) abort('Create orderForm', 'POST /api/checkout/pub/orderForm', null, 'no orderFormId in response')

  // STEP 2 — add item
  await probe('Add item', checkout, {
    method: 'post',
    url: `/api/checkout/pub/orderForm/${orderFormId}/items`,
    body: { orderItems: [{ id: SKU, quantity: 1, seller: '1' }] },
  })

  // STEP 3 — client profile
  await probe('Set client profile', checkout, {
    method: 'post',
    url: `/api/checkout/pub/orderForm/${orderFormId}/attachments/clientProfileData`,
    body: {
      email: EMAIL,
      firstName: 'Demo',
      lastName: 'Buyer',
      // EU-compatible generic doc type; "cpf" (Brazilian) is silently
      // rejected on VTEX EU and persists as null.
      documentType: 'document',
      // Skip the synthetic CPF since EU doesn't validate it; pass null
      // for parity with how the reference RO order looks.
      document: null,
      // 10-digit leading-zero local format. VTEX RO accepts "+40…" with
      // HTTP 200 but persists phone:null silently — using local form
      // keeps the field populated in the admin.
      phone: '0700000000',
      isCorporate: false,
    },
  })

  // STEP 4 — shipping
  await probe('Set shipping data', checkout, {
    method: 'post',
    url: `/api/checkout/pub/orderForm/${orderFormId}/attachments/shippingData`,
    body: {
      clearAddressIfPostalCodeNotFound: false,
      selectedAddresses: [
        {
          addressType: 'residential',
          receiverName: 'Demo Buyer',
          postalCode: SHIPPING.postalCode,
          city: SHIPPING.city,
          state: SHIPPING.state,
          country: SHIPPING.country,
          street: SHIPPING.street,
          number: SHIPPING.number,
          // Omit neighborhood when unset so VTEX persists null (matches
          // reference RO orders) instead of "".
          ...(SHIPPING.neighborhood !== undefined
            ? { neighborhood: SHIPPING.neighborhood }
            : {}),
        },
      ],
      logisticsInfo: [
        {
          itemIndex: 0,
          // Mirrors what Cart.buildLogisticsInfo sends; keeps probe
          // wire-identical to the adapter so we don't chase phantom
          // divergences in shipping calculations.
          selectedSla: 'Normal',
          selectedDeliveryChannel: 'delivery',
        },
      ],
    },
  })

  // STEP 5 — re-read orderForm so we can pick a real payment system
  const refreshed = await probe('Read orderForm + paymentSystems', checkout, {
    method: 'get',
    url: `/api/checkout/pub/orderForm/${orderFormId}`,
  })

  const orderValue = (refreshed as { value?: number }).value
  if (typeof orderValue !== 'number') {
    abort('Read orderForm', '', null, `no orderForm.value in response`)
  }
  const paymentSystems = getArray(refreshed, 'paymentData', 'paymentSystems') ?? []
  console.log(`  orderForm.value = ${orderValue}`)
  console.log(
    `  paymentSystems = ${paymentSystems
      .map((p) => {
        const ps = p as { id?: number; stringId?: string; name?: string; groupName?: string }
        return `${ps.stringId ?? ps.id}:${ps.name}/${ps.groupName}`
      })
      .join(', ')}`
  )

  const chosen = paymentSystems.find((p) => {
    const ps = p as { id?: number; stringId?: string }
    return (ps.stringId ?? String(ps.id)) === PAYMENT_SYSTEM_ID
  }) as { id: number; stringId?: string; name: string; groupName: string } | undefined

  if (!chosen) {
    abort(
      'Pick payment system',
      '',
      null,
      `Payment system ${PAYMENT_SYSTEM_ID} not configured. Available: ${paymentSystems
        .map((p) => (p as { stringId?: string; id?: number }).stringId ?? (p as { id?: number }).id)
        .join(',')}`
    )
  }

  // STEP 6 — set payment method
  await probe('Set payment data', checkout, {
    method: 'post',
    url: `/api/checkout/pub/orderForm/${orderFormId}/attachments/paymentData`,
    body: {
      payments: [
        {
          paymentSystem: chosen.stringId ?? String(chosen.id),
          paymentSystemName: chosen.name,
          group: chosen.groupName,
          installments: 1,
          installmentsInterestRate: 0,
          referenceValue: orderValue,
          value: orderValue,
          hasDefaultBillingAddress: false,
        },
      ],
    },
  })

  // STEP 7 — POST /transaction
  const placed = await probe('Place transaction', checkout, {
    method: 'post',
    url: `/api/checkout/pub/orderForm/${orderFormId}/transaction`,
    body: {
      referenceId: `probe-${Date.now()}`,
      savePersonalData: false,
      optinNewsLetter: false,
      value: orderValue,
      referenceValue: orderValue,
      interestValue: 0,
    },
  })

  // Extract the fields. VTEX puts merchantTransactions at TOP LEVEL of the
  // transaction response, and `id` at top level IS the transactionId.
  // `transactionData.merchantTransactions[]` is what /api/checkout/pub/orderForm/:id
  // GETs return — but the /transaction POST has a flatter shape.
  const orderGroup = getString(placed, 'orderGroup')
  const transactionId =
    getString(placed, 'id') ??
    getString(placed, 'merchantTransactions', '0' as never, 'transactionId')
  const receiverUri = getString(placed, 'receiverUri')

  if (!orderGroup || !transactionId) {
    abort(
      'Place transaction',
      '',
      null,
      `missing orderGroup=${orderGroup ?? '<none>'} transactionId=${transactionId ?? '<none>'}`
    )
  }

  console.log(`  → orderGroup=${orderGroup}`)
  console.log(`  → transactionId=${transactionId}`)
  if (receiverUri) {
    console.log(`  → receiverUri=${receiverUri}`)
    // Switch the payments client base to whatever VTEX told us.
    try {
      paymentsBase = new URL(receiverUri).origin
    } catch {
      /* keep the conventional default */
    }
  }

  // STEP 8 — send payments to the gateway.
  //
  // The endpoint is
  //   POST {paymentsBase}/api/pub/transactions/:tid/payments?orderId=:og
  // and the body is a BARE ARRAY of Payment objects, NOT wrapped in
  // `{payments: [...]}`. Wrapping it causes a .NET NRE on VTEX's side
  // ("Object reference not set to an instance of an object.").
  //
  // For non-card methods (Cash, redirect-based methods) the `fields`
  // object stays empty — those parameters are only meaningful for
  // typed-in card forms. paymentSystem stays as a STRING to match what
  // VTEX echoed back in `merchantTransactions[].payments[].paymentSystem`.
  const merchantName = (
    (placed as { merchantTransactions?: Array<{ merchantName?: string }> })
      .merchantTransactions?.[0]?.merchantName ?? ACCOUNT.toUpperCase()
  )

  const sendPaymentsRes = await probe('Send payments', paymentsClient(), {
    method: 'post',
    url: `/api/pub/transactions/${transactionId}/payments?orderId=${orderGroup}`,
    body: [
      {
        paymentSystem: chosen.stringId ?? String(chosen.id),
        installments: 1,
        currencyCode: 'RON',
        value: orderValue,
        installmentsInterestRate: 0,
        installmentsValue: orderValue,
        referenceValue: orderValue,
        fields: {},
        transaction: { id: transactionId, merchantName },
      },
    ],
  })

  console.log(`  send-payments shape keys: ${Object.keys((sendPaymentsRes as object) ?? {}).join(',')}`)

  // STEP 9 — authorization-request (requires AppKey/AppToken)
  if (!APP_KEY || !APP_TOKEN) {
    console.log(
      '\nSkipping authorization-request — VTEX_APP_KEY / VTEX_APP_TOKEN not set.\n' +
        `Order is created and payments are queued.\n` +
        `Verify in admin: https://${ACCOUNT}.myvtex.com/admin/checkout/#/orders — search orderGroup=${orderGroup}`
    )
    writeTrace()
    return
  }

  // Step 9 is informational for promissory / cash methods — step 8 already
  // puts the payment into the `Authorizing` state and VTEX waits for an
  // external notification (the merchant marking it paid). Calling
  // authorize-request a second time returns 1403
  // ("Authorization is pending for payments with Ids = …. A new authorization
  // execution is needed for these payments."), which is informational, not a
  // failure. We accept it as a terminal success.
  console.log('\n━━━ Step 9: Authorize transaction')
  const authUrl = `/api/pvt/transactions/${transactionId}/authorization-request`
  const authBody = {
    transactionId,
    orderId: orderGroup,
    softDescriptor: 'ACG Probe',
    prepareForRecurrency: false,
    split: [],
    callbackUrl: '',
  }

  console.log(`→ POST ${paymentsBase}${authUrl}`)
  console.log(`  body: ${JSON.stringify(authBody)}`)

  stepCounter += 1
  const authStarted = Date.now()
  const authRes = await paymentsClient().request({
    method: 'post',
    url: authUrl,
    data: authBody,
  })

  const authElapsed = Date.now() - authStarted
  const errCode = (authRes.data as { error?: { code?: string } })?.error?.code
  console.log(`← ${authRes.status} (${authElapsed}ms)`)
  console.log(`  body: ${JSON.stringify(authRes.data)}`)

  trace.push({
    step: stepCounter,
    label: 'Authorize transaction',
    request: { method: 'POST', url: `${paymentsBase}${authUrl}`, body: authBody },
    response: { status: authRes.status, body: authRes.data, durationMs: authElapsed },
  })

  const isTerminal =
    authRes.status < 400 ||
    errCode === '1403' /* already authorizing — terminal for promissory */

  if (!isTerminal) {
    abort(
      'Authorize transaction',
      `POST ${paymentsBase}${authUrl}`,
      authBody,
      authRes.data
    )
  }

  if (errCode === '1403') {
    console.log(
      '  ↳ 1403 "already authorizing" — terminal success for promissory/cash methods'
    )
  }

  // STEP 10 — process order (the official Step 3 from VTEX docs).
  //
  // Without gatewayCallback the order stays in "Se autorizează" forever
  // and VTEX cancels it after the 5-minute window. This is what actually
  // pushes the transaction into the gateway settlement pipeline.
  //
  // Reference: https://developers.vtex.com/docs/guides/creating-a-regular-order-from-an-existing-cart
  console.log('\n━━━ Step 10: Process order (gatewayCallback)')
  const processUrl = `/api/checkout/pub/gatewayCallback/${orderGroup}`
  console.log(`→ POST ${checkoutBase}${processUrl}`)

  stepCounter += 1
  const processStarted = Date.now()
  const processRes = await checkout.request({
    method: 'post',
    url: processUrl,
    data: {},
  })

  const processElapsed = Date.now() - processStarted
  console.log(`← ${processRes.status} (${processElapsed}ms)`)

  trace.push({
    step: stepCounter,
    label: 'Process order',
    request: { method: 'POST', url: `${checkoutBase}${processUrl}`, body: {} },
    response: {
      status: processRes.status,
      body: processRes.data,
      durationMs: processElapsed,
    },
  })

  if (processRes.status >= 400) {
    console.log(
      `  ⚠ gatewayCallback returned ${processRes.status} — verify in admin if the order finalized regardless.`
    )
  } else {
    console.log(
      '  ✓ gatewayCallback OK — order pushed into settlement pipeline'
    )
  }

  console.log(
    `\n✓ DONE — orderGroup=${orderGroup}\n  Verify in admin: https://${ACCOUNT}.myvtex.com/admin/checkout/#/orders`
  )
  writeTrace()
}

main().catch((e: unknown) => {
  console.error('\nUnexpected error:', e)
  writeTrace()
  process.exit(1)
})
