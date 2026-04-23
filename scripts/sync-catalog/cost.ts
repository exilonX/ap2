/**
 * Cost estimator — uses Intelligent Search to sample real ACTIVE products.
 *
 * Why Intelligent Search: it's the endpoint the storefront actually uses,
 * so it returns ONLY active, visible, in-channel products. No inactive filtering needed.
 *
 * Caveat: 2500 hard cap per query, but for a sample of ~5 products
 * the first page alone is plenty.
 */

import type { Config, VTEXProduct } from './types.ts'
import { IntelligentSearchClient } from './clients/intelligent-search.ts'
import type { IntelligentSearchProduct } from './clients/intelligent-search.ts'
import { buildProductEmbeddingText } from './embedding-text.ts'
import { formatCost, formatDuration } from './utils.ts'

const PRICING = {
  openai: {
    'text-embedding-3-small': 0.02 / 1_000_000,
    'text-embedding-3-large': 0.13 / 1_000_000,
  } as Record<string, number>,
  pinecone: {
    storagePerGBMonth: 0.33,
    bytesPerDimension: 4,
    freeTierGB: 5,
  },
}

interface FieldCoverage {
  hasProductName: boolean
  hasLinkText: boolean
  hasBrand: boolean
  hasDescription: boolean
  hasCategories: boolean
  hasSpecifications: boolean
  specCount: number
  variantCount: number
  hasImage: boolean
  hasPrice: boolean
  isGenericBrand: boolean
}

export interface SampleDetail {
  productId: string
  productName: string
  skuCount: number
  tokens: number
  chars: number
  truncated: boolean
  coverage: FieldCoverage
  embeddingText: string
  rawFields: {
    productId: string
    productName: string
    brand: string
    linkText: string
    categories: string[]
    itemCount: number
    firstItemName: string
    hasDescription: boolean
    descriptionPreview: string
    specCount: number
  }
}

export interface CostEstimate {
  sampleSize: number
  totalActiveProducts: number
  hitRecordsCap: boolean

  avgTokensPerProduct: number
  totalTokens: number
  avgTextChars: number

  embeddingCost: number
  pineconeStorageGB: number
  pineconeStorageMonthly: number
  estimatedSyncMinutes: number

  samples: SampleDetail[]
}

// ─── Helpers ───────────────────────────────────────────────────

function toVTEXProduct(isp: IntelligentSearchProduct): VTEXProduct {
  // Intelligent Search response is already ~identical to VTEXProduct for our needs
  return isp as unknown as VTEXProduct
}

function analyzeFieldCoverage(product: VTEXProduct): FieldCoverage {
  const descA = (product.description ?? '').trim()
  const specCount = (product.allSpecifications ?? []).length
  const brand = product.brand ?? ''
  const isGenericBrand = /^(test\s|brand\s|default|unknown)/i.test(brand)

  return {
    hasProductName: Boolean(product.productName),
    hasLinkText: Boolean(product.linkText),
    hasBrand: Boolean(brand) && !isGenericBrand,
    hasDescription: descA.length > 20,
    hasCategories: (product.categories ?? []).length > 0,
    hasSpecifications: specCount > 0,
    specCount,
    variantCount: product.items?.length ?? 0,
    hasImage: Boolean(product.items?.[0]?.images?.[0]?.imageUrl),
    hasPrice: (product.items?.[0]?.sellers?.[0]?.commertialOffer?.Price ?? 0) > 0,
    isGenericBrand,
  }
}

function dumpSample(sample: SampleDetail, index: number): void {
  console.log()
  console.log(`━━━ Sample ${index + 1} — Product ${sample.productId} ━━━━━━━━━━━━`)
  console.log(`Name:       ${sample.rawFields.productName}`)
  console.log(
    `Brand:      ${sample.rawFields.brand}${sample.coverage.isGenericBrand ? ' [generic — will be skipped]' : ''}`
  )
  console.log(
    `SKUs:       ${sample.rawFields.itemCount} (first: "${sample.rawFields.firstItemName}")`
  )
  console.log(
    `Categories: ${sample.rawFields.categories.slice(0, 3).join(' | ')}${
      sample.rawFields.categories.length > 3 ? ` (+${sample.rawFields.categories.length - 3} more)` : ''
    }`
  )
  console.log(`Specs:      ${sample.rawFields.specCount} specification field(s)`)
  if (sample.rawFields.hasDescription) {
    console.log(`Description: ${sample.rawFields.descriptionPreview}`)
  } else {
    console.log(`Description: [empty or very short]`)
  }

  console.log()
  console.log(`Field coverage:`)
  const c = sample.coverage
  const checks: Array<[string, boolean]> = [
    ['product name', c.hasProductName],
    ['link/slug', c.hasLinkText],
    ['brand (non-generic)', c.hasBrand],
    ['description', c.hasDescription],
    ['categories', c.hasCategories],
    [`specifications (${c.specCount})`, c.hasSpecifications],
    [`variants (${c.variantCount})`, c.variantCount > 1],
    ['image', c.hasImage],
    ['price', c.hasPrice],
  ]

  for (const [label, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  }

  console.log()
  console.log(
    `Final embedding text (${sample.tokens} tokens, ${sample.chars} chars${sample.truncated ? ', TRUNCATED' : ''}):`
  )
  console.log(`┌─────────────────────────────────────────────────────────────`)

  const lines = sample.embeddingText.split('. ').filter(Boolean)

  for (const line of lines) {
    const display = line.length > 100 ? `${line.slice(0, 100)}…` : line

    console.log(`│ ${display}`)
  }
  console.log(`└─────────────────────────────────────────────────────────────`)
}

// ─── Main estimator ────────────────────────────────────────────

export async function estimateCost(config: Config, sampleSize = 5): Promise<CostEstimate> {
  const search = new IntelligentSearchClient(config.vtex.account, config.vtex.locale)

  console.log('Querying Intelligent Search for active products...')

  // First page gives us recordsFiltered (= total active matching) and sample products.
  // NOTE: Intelligent Search is 1-indexed — page=1 is the first page.
  const firstPage = await search.productSearch({
    page: 1,
    count: Math.max(sampleSize, 10),
    hideUnavailableItems: true,
  })

  if (firstPage.products.length === 0) {
    throw new Error(
      `Intelligent Search returned 0 products for ${config.vtex.account}.\n` +
        `This is unusual — verify the store is active:\n` +
        `  https://${config.vtex.account}.vtexcommercestable.com.br/api/io/_v/api/intelligent-search/product_search?page=0&count=10&locale=${config.vtex.locale}`
    )
  }

  const totalActiveProducts = firstPage.recordsFiltered
  const hitRecordsCap = totalActiveProducts > 2500

  console.log(
    `  Intelligent Search reports ${totalActiveProducts.toLocaleString()} active products matching`
  )
  if (hitRecordsCap) {
    console.log('  ⚠ Total > 2500 → sync will need to walk by category to cover everything')
  }

  // Build sample details
  console.log()
  console.log(`Analyzing ${Math.min(sampleSize, firstPage.products.length)} sample products...`)

  const samples: SampleDetail[] = []

  for (const raw of firstPage.products.slice(0, sampleSize)) {
    const product = toVTEXProduct(raw)
    const result = buildProductEmbeddingText(product, {
      hardTokenBudget: config.sync.hardTokenBudget,
      softTokenTarget: config.sync.softTokenTarget,
    })

    const coverage = analyzeFieldCoverage(product)
    const firstItem = product.items?.[0]
    const descriptionRaw = (product.description ?? '').replace(/<[^>]*>/g, '').trim()

    samples.push({
      productId: String(product.productId),
      productName: product.productName,
      skuCount: product.items?.length ?? 0,
      tokens: result.tokens,
      chars: result.text.length,
      truncated: result.truncated,
      coverage,
      embeddingText: result.text,
      rawFields: {
        productId: String(product.productId),
        productName: product.productName,
        brand: product.brand ?? '',
        linkText: product.linkText ?? '',
        categories: (product.categories ?? []).map((c) =>
          c.replace(/\//g, ' > ').replace(/^ > | > $/g, '').trim()
        ),
        itemCount: product.items?.length ?? 0,
        firstItemName: firstItem?.nameComplete || firstItem?.name || '(none)',
        hasDescription: descriptionRaw.length > 0,
        descriptionPreview:
          descriptionRaw.length > 150 ? `${descriptionRaw.slice(0, 150)}…` : descriptionRaw,
        specCount: (product.allSpecifications ?? []).length,
      },
    })
  }

  // Compute projections
  const avgTokens = Math.round(samples.reduce((s, x) => s + x.tokens, 0) / samples.length)
  const avgChars = Math.round(samples.reduce((s, x) => s + x.chars, 0) / samples.length)
  const totalTokens = avgTokens * totalActiveProducts

  const modelPrice = PRICING.openai[config.openai.model] ?? PRICING.openai['text-embedding-3-small']
  const embeddingCost = totalTokens * modelPrice

  const bytesPerVector = config.openai.dimensions * PRICING.pinecone.bytesPerDimension
  const storageGB = (bytesPerVector * totalActiveProducts) / 1_000_000_000
  const storageMonthly =
    Math.max(0, storageGB - PRICING.pinecone.freeTierGB) * PRICING.pinecone.storagePerGBMonth

  // Sync time: IntSearch returns 50 per page, concurrency doesn't help page fetching
  // (sequential through pages). But embedding + upsert is batched.
  // Approx: (totalActive / 50) pages * ~300ms = fetch time
  const pages = Math.ceil(totalActiveProducts / 50)
  const estimatedSyncMinutes = (pages * 400) / 60_000

  return {
    sampleSize: samples.length,
    totalActiveProducts,
    hitRecordsCap,
    avgTokensPerProduct: avgTokens,
    totalTokens,
    avgTextChars: avgChars,
    embeddingCost,
    pineconeStorageGB: storageGB,
    pineconeStorageMonthly: storageMonthly,
    estimatedSyncMinutes,
    samples,
  }
}

// ─── Pretty printer ────────────────────────────────────────────

export function printEstimate(estimate: CostEstimate, config: Config): void {
  console.log()
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  DATA QUALITY — SAMPLE ACTIVE PRODUCTS')
  console.log('═══════════════════════════════════════════════════════════')

  for (let i = 0; i < estimate.samples.length; i++) {
    dumpSample(estimate.samples[i], i)
  }

  console.log()
  console.log('━━━ Aggregate field coverage ━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  const n = estimate.samples.length
  const count = (pred: (s: SampleDetail) => boolean) =>
    `${estimate.samples.filter(pred).length}/${n}`

  console.log(`  Has brand (non-generic):  ${count((s) => s.coverage.hasBrand)}`)
  console.log(`  Has description:          ${count((s) => s.coverage.hasDescription)}`)
  console.log(`  Has categories:           ${count((s) => s.coverage.hasCategories)}`)
  console.log(`  Has specifications:       ${count((s) => s.coverage.hasSpecifications)}`)
  console.log(`  Has multiple variants:    ${count((s) => s.coverage.variantCount > 1)}`)
  console.log(`  Has image:                ${count((s) => s.coverage.hasImage)}`)
  console.log(`  Has price:                ${count((s) => s.coverage.hasPrice)}`)

  const warnings: string[] = []
  const weakDescCount = estimate.samples.filter((s) => !s.coverage.hasDescription).length

  if (weakDescCount / n >= 0.5) warnings.push(`${weakDescCount}/${n} products have no description`)

  const noSpecsCount = estimate.samples.filter((s) => !s.coverage.hasSpecifications).length

  if (noSpecsCount / n >= 0.8) warnings.push(`${noSpecsCount}/${n} products have no specifications`)

  const genericBrandCount = estimate.samples.filter((s) => s.coverage.isGenericBrand).length

  if (genericBrandCount > 0) warnings.push(`${genericBrandCount}/${n} products have generic/test brand names`)

  if (warnings.length > 0) {
    console.log()
    console.log('  ⚠ Data quality warnings:')
    for (const w of warnings) console.log(`    • ${w}`)
  }

  console.log()
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  COST & TIME ESTIMATE')
  console.log('═══════════════════════════════════════════════════════════')
  console.log()
  console.log(`  Active products:      ${estimate.totalActiveProducts.toLocaleString()} (via Intelligent Search)`)
  if (estimate.hitRecordsCap) {
    console.log(`                        ⚠ Exceeds 2500-per-query cap → sync walks by category`)
  }
  console.log(`  Avg tokens/product:   ${estimate.avgTokensPerProduct} (target: ${config.sync.softTokenTarget}, hard: ${config.sync.hardTokenBudget})`)
  console.log(`  Avg chars/product:    ${estimate.avgTextChars}`)
  console.log(`  Truncated samples:    ${estimate.samples.filter((s) => s.truncated).length} / ${estimate.sampleSize}`)
  console.log()
  console.log('  ─── OpenAI Embeddings (one-time) ───')
  console.log(`  Model:                ${config.openai.model} (${config.openai.dimensions}d)`)
  console.log(`  Total tokens:         ${estimate.totalTokens.toLocaleString()}`)
  console.log(`  Cost:                 ${formatCost(estimate.embeddingCost)}`)
  console.log()
  console.log('  ─── Pinecone Storage (monthly) ───')
  console.log(`  Total storage:        ${estimate.pineconeStorageGB.toFixed(4)} GB`)
  console.log(`  Monthly cost:         ${formatCost(estimate.pineconeStorageMonthly)} (first ${PRICING.pinecone.freeTierGB}GB free)`)
  console.log()
  console.log('  ─── Time ───')
  console.log(`  Est. duration:        ${formatDuration(estimate.estimatedSyncMinutes * 60000)}`)
  console.log()
  console.log('═══════════════════════════════════════════════════════════')
  console.log()
}
