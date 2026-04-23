#!/usr/bin/env node

/**
 * RAG Pipeline Test Script
 *
 * Tests the full flow outside VTEX IO infrastructure:
 *   1. Fetch product IDs from VTEX (GetProductAndSkuIds)
 *   2. Fetch product details per ID
 *   3. Build embedding texts
 *   4. Call OpenAI embeddings API
 *   5. Upsert vectors to Pinecone
 *   6. Run a semantic search query
 *
 * Usage:
 *   node scripts/test-rag-pipeline.mjs
 *
 * Required env vars (or edit CONFIG below):
 *   VTEX_ACCOUNT        — e.g. "vtexeurope"
 *   VTEX_WORKSPACE      — e.g. "acg" (or "master")
 *   VTEX_APP_KEY        — VTEX API app key
 *   VTEX_APP_TOKEN      — VTEX API app token
 *   OPENAI_API_KEY      — OpenAI key (for embeddings)
 *   PINECONE_API_KEY    — Pinecone key
 *   PINECONE_INDEX_HOST — e.g. "acg-products-xxxxx.svc.aped-1234.pinecone.io"
 */

// ─── Config ─────────────────────────────────────────────────────

const CONFIG = {
  vtex: {
    account: process.env.VTEX_ACCOUNT || 'vtexeurope',
    workspace: process.env.VTEX_WORKSPACE || 'master',
    appKey: process.env.VTEX_APP_KEY || '',
    appToken: process.env.VTEX_APP_TOKEN || '',
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'text-embedding-3-small',
    dimensions: 512,
  },
  pinecone: {
    apiKey: process.env.PINECONE_API_KEY || '',
    indexHost: process.env.PINECONE_INDEX_HOST || '',
    namespace: 'products',
  },
  // How many products to test with (set low for quick test)
  testLimit: 10,
}

// ─── Helpers ────────────────────────────────────────────────────

function log(step, msg, data) {
  const ts = new Date().toISOString().slice(11, 19)
  const prefix = `[${ts}] [Step ${step}]`

  console.log(`${prefix} ${msg}`)
  if (data) {
    console.log(`${prefix}   →`, typeof data === 'string' ? data : JSON.stringify(data, null, 2).slice(0, 500))
  }
}

function fail(step, msg, error) {
  console.error(`\n❌ FAILED at Step ${step}: ${msg}`)
  if (error) {
    console.error('   Error:', error.message || error)
    if (error.status) console.error('   Status:', error.status)
    if (error.body) console.error('   Body:', JSON.stringify(error.body).slice(0, 300))
  }

  process.exit(1)
}

async function fetchJSON(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers,
    },
  })

  const text = await res.text()
  let body

  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${res.statusText}`)

    err.status = res.status
    err.body = body
    throw err
  }

  return body
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Step 1: Fetch Product IDs from VTEX ────────────────────────

async function step1_fetchProductIds() {
  log(1, 'Fetching product IDs from VTEX Catalog API...')

  const baseUrl = `https://${CONFIG.vtex.account}.vtexcommercestable.com.br`
  const headers = {
    'X-VTEX-API-AppKey': CONFIG.vtex.appKey,
    'X-VTEX-API-AppToken': CONFIG.vtex.appToken,
  }

  // Method A: GetProductAndSkuIds (private API, needs auth)
  log(1, 'Trying GetProductAndSkuIds (private API)...')

  try {
    const result = await fetchJSON(
      `${baseUrl}/api/catalog_system/pvt/products/GetProductAndSkuIds?_from=0&_to=49`,
      { headers }
    )

    const productIds = Object.keys(result.data || result).map(Number)

    log(1, `GetProductAndSkuIds returned ${productIds.length} products`, {
      range: result.range,
      firstIds: productIds.slice(0, 5),
    })

    return { method: 'GetProductAndSkuIds', productIds, total: result.range?.total }
  } catch (error) {
    log(1, `GetProductAndSkuIds failed (${error.status}), trying fallback...`)
  }

  // Method B: stockkeepingunitids (private API)
  log(1, 'Trying stockkeepingunitids...')

  try {
    const result = await fetchJSON(
      `${baseUrl}/api/catalog_system/pvt/sku/stockkeepingunitids?page=1&pagesize=50`,
      { headers }
    )

    log(1, `stockkeepingunitids returned ${Array.isArray(result) ? result.length : '?'} SKU IDs`, {
      firstIds: Array.isArray(result) ? result.slice(0, 5) : result,
    })

    return { method: 'stockkeepingunitids', productIds: result, total: null }
  } catch (error) {
    log(1, `stockkeepingunitids also failed (${error.status}), trying search fallback...`)
  }

  // Method C: Public search (limited to 2500 but works without auth)
  log(1, 'Trying public search API (limited to 2500)...')

  try {
    const products = await fetchJSON(
      `${baseUrl}/api/catalog_system/pub/products/search?_from=0&_to=49`
    )

    const productIds = products.map((p) => Number(p.productId))

    log(1, `Public search returned ${productIds.length} products`, {
      firstIds: productIds.slice(0, 5),
    })

    return { method: 'public-search', productIds, total: null, fullProducts: products }
  } catch (error) {
    fail(1, 'All VTEX catalog APIs failed', error)
  }
}

// ─── Step 2: Fetch Product Details ──────────────────────────────

async function step2_fetchProductDetails(productIds, fullProducts) {
  log(2, `Fetching details for ${productIds.length} products...`)

  const baseUrl = `https://${CONFIG.vtex.account}.vtexcommercestable.com.br`

  // If we already have full products from search, use those
  if (fullProducts && fullProducts.length > 0) {
    log(2, 'Using products from search (already have details)')

    return fullProducts.slice(0, CONFIG.testLimit)
  }

  const headers = {
    'X-VTEX-API-AppKey': CONFIG.vtex.appKey,
    'X-VTEX-API-AppToken': CONFIG.vtex.appToken,
  }

  const idsToFetch = productIds.slice(0, CONFIG.testLimit)
  const products = []

  for (const id of idsToFetch) {
    try {
      const result = await fetchJSON(
        `${baseUrl}/api/catalog_system/pub/products/search?fq=productId:${id}`,
        { headers }
      )

      if (result.length > 0) {
        products.push(result[0])
      }

      await sleep(200) // Throttle
    } catch (error) {
      log(2, `Failed to fetch product ${id}: ${error.message}`)
    }
  }

  log(2, `Fetched ${products.length} product details`)

  return products
}

// ─── Step 2.5: Dump raw product for inspection ──────────────────

function step2_5_dumpRawProduct(products) {
  if (products.length === 0) return

  const p = products[0]

  console.log('\n── DEBUG: Full raw VTEX product JSON (first product) ────')
  console.log(JSON.stringify(p, null, 2))
  console.log('\n── DEBUG: Fields summary ─────────────────────────────────')

  const summary = {
    productId: p.productId,
    productName: p.productName,
    productTitle: p.productTitle,
    brand: p.brand,
    description: p.description ? `${p.description.slice(0, 150)}...` : '(empty)',
    metaTagDescription: p.metaTagDescription ? `${p.metaTagDescription.slice(0, 150)}...` : '(empty)',
    categories: p.categories,
    allSpecifications: p.allSpecifications,
    clusterHighlights: p.clusterHighlights,
    productClusters: p.productClusters,
    searchableClusters: p.searchableClusters,
    itemCount: p.items?.length,
    firstItem: p.items?.[0] ? {
      itemId: p.items[0].itemId,
      name: p.items[0].name,
      nameComplete: p.items[0].nameComplete,
      complementName: p.items[0].complementName,
      variations: p.items[0].variations,
    } : null,
  }

  console.log(JSON.stringify(summary, null, 2))

  // Show specifications if present
  if (p.allSpecifications && p.allSpecifications.length > 0) {
    console.log('\n── DEBUG: Specifications with values ─────────────────────')
    for (const spec of p.allSpecifications) {
      console.log(`   ${spec}: ${JSON.stringify(p[spec])}`)
    }
  }

  console.log()
}

// ─── Step 3: Build Embedding Texts ──────────────────────────────

function step3_buildEmbeddingTexts(products) {
  log(3, `Building embedding texts for ${products.length} products...`)

  const texts = products.map((p) => {
    const sku = p.items?.[0]
    const seller = sku?.sellers?.[0]
    const price = seller?.commertialOffer?.Price || 0

    const parts = []

    // 1. Name + slug
    parts.push(`Product: ${p.productName}`)
    if (p.linkText && p.linkText.toLowerCase() !== p.productName.toLowerCase()) {
      parts.push(`(${p.linkText})`)
    }

    // 2. SKU variant names — often contain color/size
    const variantNames = [...new Set(
      (p.items || [])
        .map((i) => i.nameComplete || i.name)
        .filter((n) => n && n !== p.productName)
    )]
    if (variantNames.length > 0) {
      parts.push(`Variants: ${variantNames.slice(0, 10).join(', ')}`)
    }

    // 3. All category levels
    if (p.categories && p.categories.length > 0) {
      const cleaned = p.categories
        .map((c) => c.replace(/\//g, ' > ').replace(/^ > | > $/g, '').trim())
        .filter(Boolean)

      if (cleaned.length > 0) {
        parts.push(`Categories: ${cleaned.join(' | ')}`)
      }
    }

    // 4. Brand (skip generic placeholders)
    if (p.brand && !/^test\s|^brand\s|^default/i.test(p.brand)) {
      parts.push(`Brand: ${p.brand}`)
    }

    // 5. Best description (longer of description vs metaTagDescription)
    const descA = (p.description || '').replace(/<[^>]*>/g, '').trim()
    const descB = (p.metaTagDescription || '').replace(/<[^>]*>/g, '').trim()
    const bestDesc = descA.length >= descB.length ? descA : descB
    if (bestDesc) {
      const truncated = bestDesc.length > 500 ? `${bestDesc.slice(0, 500)}...` : bestDesc
      parts.push(truncated)
    }

    // 6. Specifications
    if (p.allSpecifications && p.allSpecifications.length > 0) {
      const specs = p.allSpecifications
        .slice(0, 15)
        .map((spec) => {
          const val = p[spec]

          return val ? `${spec}: ${Array.isArray(val) ? val.join(', ') : val}` : null
        })
        .filter(Boolean)
        .join(', ')

      if (specs) parts.push(`Specs: ${specs}`)
    }

    // 7. Cluster tags (skip useless "Lengow" feed tag)
    if (p.productClusters) {
      const tags = Object.values(p.productClusters)
        .filter((t) => typeof t === 'string' && !/^lengow$/i.test(t))

      if (tags.length > 0) parts.push(`Tags: ${tags.join(', ')}`)
    }

    // 8. Price
    if (price > 0) parts.push(`Price: ${price} RON`)

    return parts.join('. ')
  })

  for (let i = 0; i < Math.min(3, texts.length); i++) {
    log(3, `Product ${i + 1}:`, texts[i].slice(0, 300))
  }

  log(3, `Built ${texts.length} texts, avg length: ${Math.round(texts.reduce((s, t) => s + t.length, 0) / texts.length)} chars`)

  return texts
}

// ─── Step 4: Call OpenAI Embeddings ─────────────────────────────

async function step4_embed(texts) {
  log(4, `Embedding ${texts.length} texts via OpenAI (${CONFIG.openai.model}, ${CONFIG.openai.dimensions}d)...`)

  if (!CONFIG.openai.apiKey) {
    fail(4, 'OPENAI_API_KEY not set')
  }

  const startTime = Date.now()

  const result = await fetchJSON('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CONFIG.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.openai.model,
      input: texts,
      dimensions: CONFIG.openai.dimensions,
    }),
  })

  const elapsed = Date.now() - startTime
  const vectors = result.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)

  log(4, `Embedded ${vectors.length} texts in ${elapsed}ms`, {
    tokens: result.usage?.total_tokens,
    cost: `$${((result.usage?.total_tokens || 0) * 0.00000002).toFixed(6)}`,
    vectorDimensions: vectors[0]?.length,
    firstVector: `[${vectors[0]?.slice(0, 5).map((n) => n.toFixed(4)).join(', ')}, ...]`,
  })

  return vectors
}

// ─── Step 5: Upsert to Pinecone ─────────────────────────────────

async function step5_upsertPinecone(products, vectors) {
  log(5, `Upserting ${vectors.length} vectors to Pinecone...`)

  if (!CONFIG.pinecone.apiKey || !CONFIG.pinecone.indexHost) {
    log(5, '⚠️  PINECONE_API_KEY or PINECONE_INDEX_HOST not set — SKIPPING Pinecone upsert')
    log(5, 'Set these env vars to test Pinecone integration')

    return false
  }

  const pineconeVectors = vectors.map((values, i) => {
    const p = products[i]
    const sku = p.items?.[0]
    const seller = sku?.sellers?.[0]

    return {
      id: `product-${sku?.itemId || p.productId}`,
      values,
      metadata: {
        sku: sku?.itemId || p.productId,
        name: p.productName,
        price: seller?.commertialOffer?.Price || 0,
        originalPrice: seller?.commertialOffer?.ListPrice || 0,
        image: sku?.images?.[0]?.imageUrl || '',
        category: p.categories?.[0] || '',
        brand: p.brand || '',
        available: (seller?.commertialOffer?.AvailableQuantity || 0) > 0,
      },
    }
  })

  const startTime = Date.now()

  // First delete existing vectors in namespace
  try {
    await fetchJSON(`https://${CONFIG.pinecone.indexHost}/vectors/delete`, {
      method: 'POST',
      headers: { 'Api-Key': CONFIG.pinecone.apiKey },
      body: JSON.stringify({
        deleteAll: true,
        namespace: CONFIG.pinecone.namespace,
      }),
    })

    log(5, 'Cleared existing vectors')
  } catch (error) {
    log(5, `Delete failed (might be empty): ${error.message}`)
  }

  // Upsert
  const result = await fetchJSON(`https://${CONFIG.pinecone.indexHost}/vectors/upsert`, {
    method: 'POST',
    headers: { 'Api-Key': CONFIG.pinecone.apiKey },
    body: JSON.stringify({
      vectors: pineconeVectors,
      namespace: CONFIG.pinecone.namespace,
    }),
  })

  const elapsed = Date.now() - startTime

  log(5, `Upserted ${result.upsertedCount} vectors in ${elapsed}ms`, {
    namespace: CONFIG.pinecone.namespace,
    sampleId: pineconeVectors[0]?.id,
    sampleMeta: pineconeVectors[0]?.metadata?.name,
  })

  return true
}

// ─── Step 6: Semantic Search Test ───────────────────────────────

async function step6_semanticSearch(testQueries) {
  log(6, 'Testing semantic search...')

  if (!CONFIG.pinecone.apiKey || !CONFIG.pinecone.indexHost) {
    log(6, '⚠️  Pinecone not configured — SKIPPING semantic search test')

    return
  }

  // Wait a moment for Pinecone to index
  log(6, 'Waiting 3s for Pinecone to index...')
  await sleep(3000)

  for (const query of testQueries) {
    log(6, `\nQuery: "${query}"`)

    // Embed the query
    const embedResult = await fetchJSON('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${CONFIG.openai.apiKey}` },
      body: JSON.stringify({
        model: CONFIG.openai.model,
        input: query,
        dimensions: CONFIG.openai.dimensions,
      }),
    })

    const queryVector = embedResult.data[0].embedding

    // Search Pinecone
    const searchResult = await fetchJSON(`https://${CONFIG.pinecone.indexHost}/query`, {
      method: 'POST',
      headers: { 'Api-Key': CONFIG.pinecone.apiKey },
      body: JSON.stringify({
        vector: queryVector,
        topK: 5,
        namespace: CONFIG.pinecone.namespace,
        includeMetadata: true,
      }),
    })

    if (searchResult.matches?.length > 0) {
      for (const match of searchResult.matches) {
        const meta = match.metadata || {}
        const score = (match.score * 100).toFixed(1)

        console.log(`   ${score}% — ${meta.name} (SKU: ${meta.sku}) — ${meta.price} RON`)
      }
    } else {
      console.log('   No matches found')
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  RAG Pipeline Test — End-to-End Validation')
  console.log('═══════════════════════════════════════════════════════')
  console.log()
  console.log(`  VTEX Account:  ${CONFIG.vtex.account}`)
  console.log(`  VTEX Auth:     ${CONFIG.vtex.appKey ? '✓ configured' : '✗ missing (will use public APIs)'}`)
  console.log(`  OpenAI:        ${CONFIG.openai.apiKey ? '✓ configured' : '✗ missing'}`)
  console.log(`  Pinecone:      ${CONFIG.pinecone.indexHost ? '✓ configured' : '✗ missing (will skip)'}`)
  console.log(`  Test limit:    ${CONFIG.testLimit} products`)
  console.log()

  if (!CONFIG.openai.apiKey) {
    fail(0, 'OPENAI_API_KEY is required. Set it as env var.')
  }

  const startTime = Date.now()

  // Step 1: Fetch product IDs
  console.log('\n── Step 1: Fetch Product IDs ─────────────────────────')
  const { method, productIds, total, fullProducts } = await step1_fetchProductIds()

  log(1, `✓ Success via ${method}`, { count: productIds.length, total: total || 'unknown' })

  // Step 2: Fetch product details
  console.log('\n── Step 2: Fetch Product Details ─────────────────────')
  const products = await step2_fetchProductDetails(productIds, fullProducts)

  log(2, `✓ Got ${products.length} full products`)

  if (products.length === 0) {
    fail(2, 'No products fetched. Check your VTEX account has products.')
  }

  // Step 2.5: Dump the raw JSON of the first product so we can see exactly
  // what fields are available to embed
  step2_5_dumpRawProduct(products)

  // Step 3: Build embedding texts
  console.log('\n── Step 3: Build Embedding Texts ─────────────────────')
  const texts = step3_buildEmbeddingTexts(products)

  log(3, `✓ Built ${texts.length} texts`)

  // Step 4: Embed via OpenAI
  console.log('\n── Step 4: OpenAI Embeddings ─────────────────────────')
  const vectors = await step4_embed(texts)

  log(4, `✓ Got ${vectors.length} vectors of ${vectors[0]?.length}d`)

  // Step 5: Upsert to Pinecone
  console.log('\n── Step 5: Pinecone Upsert ──────────────────────────')
  const pineconeOk = await step5_upsertPinecone(products, vectors)

  if (pineconeOk) {
    log(5, '✓ Vectors stored in Pinecone')
  }

  // Step 6: Semantic search test
  console.log('\n── Step 6: Semantic Search ──────────────────────────')
  await step6_semanticSearch([
    'ceva mai gros',              // Romanian: "something thicker" → should find hoodies
    'warm clothing for winter',   // English semantic
    'cheap shoes',                // price-aware
    'tricou',                     // exact product match
    'cadou pentru ea',            // "gift for her" → semantic understanding
  ])

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`  ✅ Pipeline test complete in ${elapsed}s`)
  console.log(`  Products: ${products.length}`)
  console.log(`  Vectors:  ${vectors.length} × ${vectors[0]?.length}d`)
  console.log(`  Pinecone: ${pineconeOk ? 'synced' : 'skipped'}`)
  console.log('═══════════════════════════════════════════════════════')
}

main().catch((error) => {
  console.error('\n💥 Unhandled error:', error)
  process.exit(1)
})
