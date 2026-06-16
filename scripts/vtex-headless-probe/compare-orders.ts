/**
 * compare-orders.ts — diff two VTEX OMS orders side-by-side.
 *
 * Use it when one order looks "wrong" in VTEX admin (e.g. shows
 * "Fără denumire" on the transaction widget) and you want to see EXACTLY
 * which fields differ from a healthy reference order. Fetches both via
 * `/api/oms/pvt/orders/:orderId` (needs VTEX_APP_KEY + VTEX_APP_TOKEN),
 * walks a curated list of high-signal paths, and prints a structured
 * diff. Full JSON dumps go to `compares/<orderId>.json` so you can grep
 * for fields the curated list doesn't cover.
 *
 * Usage:
 *   tsx compare-orders.ts <orderIdA> <orderIdB>
 *
 * Both orderIds should include the seller suffix (e.g. "1638950533627-01").
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import axios from 'axios'

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

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(
      `Missing required env var: ${name}. Add it to scripts/vtex-headless-probe/.env`
    )
    process.exit(1)
  }
  return v
}

const ACCOUNT = required('VTEX_ACCOUNT')
const APP_KEY = required('VTEX_APP_KEY')
const APP_TOKEN = required('VTEX_APP_TOKEN')

const [orderIdA, orderIdB] = process.argv.slice(2)
if (!orderIdA || !orderIdB) {
  console.error(
    'Usage: tsx compare-orders.ts <orderIdA> <orderIdB>\n' +
      'Both orderIds must include the seller suffix, e.g. "1638950533627-01".'
  )
  process.exit(1)
}

const client = axios.create({
  baseURL: `https://${ACCOUNT}.vtexcommercestable.com.br`,
  headers: {
    'X-VTEX-API-AppKey': APP_KEY,
    'X-VTEX-API-AppToken': APP_TOKEN,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'vtex-headless-probe/compare-orders',
  },
  validateStatus: () => true,
  timeout: 30000,
})

async function fetchOrder(orderId: string): Promise<unknown> {
  const r = await client.get(`/api/oms/pvt/orders/${orderId}`)
  if (r.status >= 400) {
    console.error(
      `✗ Failed to fetch order ${orderId}: ${r.status}\n${JSON.stringify(
        r.data,
        null,
        2
      )}`
    )
    process.exit(1)
  }
  return r.data
}

function getPath(obj: unknown, path: string): unknown {
  // Handles dot-notation and `[N]` array indexing.
  const segments = path.split('.').flatMap((p) => {
    const m = p.match(/^([^[]+)((?:\[\d+\])+)?$/)
    if (!m) return [p]
    const result = [m[1]]
    if (m[2]) {
      const indices = m[2].match(/\d+/g) ?? []
      for (const i of indices) result.push(i)
    }
    return result
  })

  let cur: unknown = obj
  for (const s of segments) {
    if (cur == null) return undefined
    if (Array.isArray(cur)) {
      const i = Number(s)
      if (Number.isNaN(i)) return undefined
      cur = cur[i]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[s]
    } else {
      return undefined
    }
  }
  return cur
}

// Curated fields most likely to explain admin-UI differences. Grouped
// by topic so the diff output reads top-to-bottom in a logical order.
const FIELDS_TO_COMPARE: Array<{ section: string; paths: string[] }> = [
  {
    section: 'order envelope',
    paths: [
      'orderId',
      'orderGroup',
      'status',
      'statusDescription',
      'sequence',
      'salesChannel',
      'origin',
      'affiliateId',
      'value',
      'totalSpentEarningsValue',
      'workflowIsInError',
      'workflowInRetry',
      'lastChange',
      'creationDate',
      'authorizedDate',
      'invoicedDate',
      'allowCancellation',
      'allowEdition',
      'isCompleted',
      'isCheckedIn',
      'callCenterOperatorData',
      'subscriptionData',
    ],
  },
  {
    section: 'clientProfileData (customer)',
    paths: [
      'clientProfileData.id',
      'clientProfileData.email',
      'clientProfileData.firstName',
      'clientProfileData.lastName',
      'clientProfileData.documentType',
      'clientProfileData.document',
      'clientProfileData.phone',
      'clientProfileData.corporateName',
      'clientProfileData.tradeName',
      'clientProfileData.corporateDocument',
      'clientProfileData.stateInscription',
      'clientProfileData.corporatePhone',
      'clientProfileData.isCorporate',
      'clientProfileData.userProfileId',
      'clientProfileData.userProfileVersion',
      'clientProfileData.customerClass',
    ],
  },
  {
    section: 'shippingData.address',
    paths: [
      'shippingData.id',
      'shippingData.address.addressType',
      'shippingData.address.receiverName',
      'shippingData.address.addressId',
      'shippingData.address.versionId',
      'shippingData.address.entityId',
      'shippingData.address.postalCode',
      'shippingData.address.city',
      'shippingData.address.state',
      'shippingData.address.country',
      'shippingData.address.street',
      'shippingData.address.number',
      'shippingData.address.neighborhood',
      'shippingData.address.complement',
      'shippingData.address.reference',
      'shippingData.address.geoCoordinates',
      'shippingData.selectedAddresses[0].addressId',
      'shippingData.selectedAddresses[0].addressType',
      'shippingData.selectedAddresses[0].receiverName',
      'shippingData.logisticsInfo[0].itemIndex',
      'shippingData.logisticsInfo[0].selectedDeliveryChannel',
      'shippingData.logisticsInfo[0].selectedSla',
      'shippingData.logisticsInfo[0].deliveryWindow',
    ],
  },
  {
    section: 'paymentData (top level)',
    paths: ['paymentData.giftCards', 'paymentData.giftCardMessages'],
  },
  {
    section: 'paymentData.transactions[0]',
    paths: [
      'paymentData.transactions[0].isActive',
      'paymentData.transactions[0].transactionId',
      'paymentData.transactions[0].merchantName',
      'paymentData.transactions[0].payments[0].id',
      'paymentData.transactions[0].payments[0].paymentSystem',
      'paymentData.transactions[0].payments[0].paymentSystemName',
      'paymentData.transactions[0].payments[0].group',
      'paymentData.transactions[0].payments[0].value',
      'paymentData.transactions[0].payments[0].installments',
      'paymentData.transactions[0].payments[0].referenceValue',
      'paymentData.transactions[0].payments[0].interestValue',
      'paymentData.transactions[0].payments[0].interestRate',
      'paymentData.transactions[0].payments[0].installmentsInterestRate',
      'paymentData.transactions[0].payments[0].installmentsValue',
      'paymentData.transactions[0].payments[0].cardHolder',
      'paymentData.transactions[0].payments[0].cardNumber',
      'paymentData.transactions[0].payments[0].firstDigits',
      'paymentData.transactions[0].payments[0].lastDigits',
      'paymentData.transactions[0].payments[0].cvv2',
      'paymentData.transactions[0].payments[0].expireMonth',
      'paymentData.transactions[0].payments[0].expireYear',
      'paymentData.transactions[0].payments[0].url',
      'paymentData.transactions[0].payments[0].giftCardId',
      'paymentData.transactions[0].payments[0].giftCardName',
      'paymentData.transactions[0].payments[0].giftCardCaption',
      'paymentData.transactions[0].payments[0].redemptionCode',
      'paymentData.transactions[0].payments[0].koinUrl',
      'paymentData.transactions[0].payments[0].accountId',
      'paymentData.transactions[0].payments[0].parentAccountId',
      'paymentData.transactions[0].payments[0].tid',
      'paymentData.transactions[0].payments[0].dueDate',
      'paymentData.transactions[0].payments[0].connectorResponses',
      'paymentData.transactions[0].payments[0].giftCardProvider',
    ],
  },
  {
    section: 'first item (items[0])',
    paths: [
      'items[0].id',
      'items[0].productId',
      'items[0].refId',
      'items[0].name',
      'items[0].price',
      'items[0].listPrice',
      'items[0].sellingPrice',
      'items[0].quantity',
      'items[0].seller',
      'items[0].sellerSku',
    ],
  },
]

function flag(equal: boolean): string {
  return equal ? '✓' : '✗'
}

function brief(v: unknown): string {
  if (v === undefined) return '<undefined>'
  if (v === null) return '<null>'
  const s = JSON.stringify(v)
  return s.length > 160 ? s.slice(0, 160) + '…' : s
}

async function main(): Promise<void> {
  console.log(`Fetching orders…`)
  console.log(`  A: ${orderIdA}`)
  console.log(`  B: ${orderIdB}\n`)

  const [a, b] = await Promise.all([fetchOrder(orderIdA), fetchOrder(orderIdB)])

  const outDir = join(__dirname, 'compares')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, `${orderIdA}.json`), JSON.stringify(a, null, 2))
  writeFileSync(join(outDir, `${orderIdB}.json`), JSON.stringify(b, null, 2))

  console.log(`Full JSON dumps written to scripts/vtex-headless-probe/compares/\n`)
  console.log(`Legend: ✓ identical   ✗ different   (only ✗ rows are printed)\n`)

  let diffCount = 0

  for (const group of FIELDS_TO_COMPARE) {
    let groupHeaderPrinted = false

    for (const path of group.paths) {
      const va = getPath(a, path)
      const vb = getPath(b, path)
      const equal = JSON.stringify(va) === JSON.stringify(vb)

      if (equal) continue

      if (!groupHeaderPrinted) {
        console.log(`━━━ ${group.section}`)
        groupHeaderPrinted = true
      }

      console.log(`${flag(equal)} ${path}`)
      console.log(`    A: ${brief(va)}`)
      console.log(`    B: ${brief(vb)}`)
      diffCount += 1
    }

    if (groupHeaderPrinted) console.log()
  }

  console.log(`Total fields differing on the curated list: ${diffCount}`)
  console.log(
    `For exhaustive comparison, diff scripts/vtex-headless-probe/compares/${orderIdA}.json ` +
      `vs ${orderIdB}.json with your favourite tool (jq, code --diff, etc.).`
  )
}

main().catch((e: unknown) => {
  console.error('\nUnexpected error:', e)
  process.exit(1)
})
