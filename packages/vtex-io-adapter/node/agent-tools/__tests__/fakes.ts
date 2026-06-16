/**
 * Shared test doubles for AgentTool tests.
 *
 * Reuses Issue 02's `FakeCheckoutClient` and Issue 01's `FakeVBase`
 * (memory: `feedback_test_as_we_go` — reuse don't reimplement).
 *
 * `makeFakeToolContext()` returns a ToolContext-shaped object with
 * fakes wired in. Tests can override individual fields. Each call gets
 * a fresh checkout + vbase pair.
 */

import {
  FakeCheckoutClient,
  makeEmptyOrderForm,
  makeItem,
} from '../../cart/__tests__/fake-checkout'
import { FakePaymentsClient } from '../../cart/__tests__/fake-payments'
import { FakeVBase } from '../../identity/__tests__/fake-vbase'
import type { ClientConfig } from '../../config/types'
import type { ToolContext } from '../types'
import type { VTEXOrderForm } from '../../clients/checkout'

export interface FakeToolDeps {
  ctx: ToolContext
  checkout: FakeCheckoutClient
  payments: FakePaymentsClient
  vbase: FakeVBase
}

const MIN_CONFIG: ClientConfig = ({
  account: 'fake',
  industry: 'generic',
  brand: { name: 'Fake Store', accentColor: '#000', tone: 'neutral' },
  locales: { default: 'en', available: ['en'] },
  llmContext: '',
  customRules: [],
  starters: { en: [] },
  strings: {
    en: {
      greeting: '',
      placeholder: '',
      headerTitle: '',
      headerStatus: '',
      poweredBy: '',
      errorConnection: '',
    },
  },
  confirmationStyle: 'terse',
  multiStepFlow: 'parallel',
} as unknown) as ClientConfig

/**
 * Build a fresh ToolContext with fakes wired in.
 *
 * @param opts.orderFormId — pre-set orderFormId (default: 'of-test-1', which the seedCart helper will populate).
 * @param opts.workspace / opts.account — used to compose the merchant DID domain.
 */
export function makeFakeToolContext(
  opts: {
    orderFormId?: string | null
    workspace?: string
    account?: string
    config?: ClientConfig
    appSettings?: Record<string, unknown>
  } = {}
): FakeToolDeps {
  const checkout = new FakeCheckoutClient()
  const payments = new FakePaymentsClient()
  const vbase = new FakeVBase()
  // Minimal IOClients.apps shim — only the surface the agent tools actually
  // read (getAppSettings). authorize_transaction reads vtexAppKey /
  // vtexAppToken here; tests that want to exercise the credentials path
  // pass them through opts.appSettings.
  const apps = {
    getAppSettings: async () => opts.appSettings ?? {},
  }

  const ctx: ToolContext = {
    vtex: {
      workspace: opts.workspace ?? 'master',
      account: opts.account ?? 'fakeacct',
    } as ToolContext['vtex'],
    clients: ({
      checkout,
      payments,
      vbase,
      apps,
    } as unknown) as ToolContext['clients'],
    config: opts.config ?? MIN_CONFIG,
    orderFormId:
      opts.orderFormId === undefined ? 'of-test-1' : opts.orderFormId,
  }

  return { ctx, checkout, payments, vbase }
}

/**
 * Seed a populated cart in the FakeCheckoutClient.
 *
 * Returns the seeded `VTEXOrderForm` so tests can poke at internals if
 * needed. The orderFormId matches whatever `ctx.orderFormId` is.
 */
export function seedCart(
  deps: FakeToolDeps,
  items: Array<{ sku: string; quantity: number; unitPriceCents?: number }> = [
    { sku: 'sku-1', quantity: 1, unitPriceCents: 5000 },
  ]
): VTEXOrderForm {
  const id = deps.ctx.orderFormId ?? 'of-test-1'
  const of = makeEmptyOrderForm(id)

  for (const it of items) {
    of.items.push(makeItem(it.sku, it.quantity, it.unitPriceCents ?? 5000))
  }

  // Recompute totals
  of.value = of.items.reduce((s, i) => s + i.sellingPrice * i.quantity, 0)
  of.totalizers = [{ id: 'Items', name: 'Items', value: of.value }]
  deps.checkout.seed(of)

  return of
}
