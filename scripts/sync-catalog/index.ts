#!/usr/bin/env node
/**
 * CLI entry point for the catalog sync script.
 *
 * Usage:
 *   tsx index.ts                         # Full sync (resumes if state exists)
 *   tsx index.ts --fresh                 # Fresh sync (clears state + Pinecone namespace)
 *   tsx index.ts --retry                 # Retry failed products only
 *   tsx index.ts --estimate              # Cost estimate only (no API writes)
 *   tsx index.ts --query "ceva gros"     # Semantic search test
 *   tsx index.ts --limit 100             # Sync only first 100 products
 *   tsx index.ts --concurrency 30        # Override parallel request count
 *   tsx index.ts --config path           # Use a different config file
 */

import { loadConfig } from './config.ts'
import { estimateCost, printEstimate } from './cost.ts'
import { runQuery } from './query.ts'
import { runRetry, runSync } from './sync.ts'
import type { CliArgs } from './types.ts'

// ─── CLI argument parsing ──────────────────────────────────────

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { mode: 'sync' }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]

    switch (arg) {
      case '--fresh':
        args.mode = 'fresh'
        break
      case '--retry':
        args.mode = 'retry'
        break
      case '--estimate':
        args.mode = 'estimate'
        break
      case '--query':
      case '-q':
        args.mode = 'query'
        args.query = argv[++i]
        if (!args.query) throw new Error('--query requires text in quotes')
        break
      case '--top':
        args.topK = Number(argv[++i])
        if (Number.isNaN(args.topK)) throw new Error('--top requires a number')
        break
      case '--on-sale':
        args.onSaleOnly = true
        break
      case '--config':
        args.configPath = argv[++i]
        break
      case '--limit':
        args.limit = Number(argv[++i])
        if (Number.isNaN(args.limit)) throw new Error('--limit requires a number')
        break
      case '--concurrency':
        args.concurrency = Number(argv[++i])
        if (Number.isNaN(args.concurrency)) throw new Error('--concurrency requires a number')
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  return args
}

function printHelp(): void {
  console.log(`
Catalog Sync — VTEX → OpenAI → Pinecone

Usage:
  tsx index.ts [options]

Modes:
  (default)             Full sync (resumes from state if present)
  --fresh               Fresh sync — clears state & Pinecone namespace
  --retry               Retry only failed products from error queue
  --estimate            Estimate cost & time — no API writes
  --query "<text>"      Semantic search: embed query, return top matches
                        Use --top N to change result count (default 5)
                        Add --on-sale to filter to discounted products only

Options:
  --config <path>       Path to config.json (default: ./config.json)
  --limit <n>           Sync only first N products
  --concurrency <n>     Override parallel request count (default 20)
  -h, --help            Show this help

Examples:
  tsx index.ts --query "ceva mai gros"
  tsx index.ts --query "sandale pentru fete" --top 10
  tsx index.ts --fresh --limit 100

Setup:
  cp config.example.json config.json   # then fill in credentials
  npm install
`)
}

// ─── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const config = await loadConfig({
    configPath: args.configPath,
    concurrencyOverride: args.concurrency,
  })

  console.log()
  console.log(`Mode:     ${args.mode}`)
  console.log(`Account:  ${config.vtex.account} / ${config.vtex.workspace}`)
  console.log(`Model:    ${config.openai.model} (${config.openai.dimensions}d)`)
  console.log(`Index:    ${config.pinecone.indexHost} (namespace: ${config.pinecone.namespace})`)
  if (args.mode !== 'query') {
    console.log(`Budget:   ${config.sync.softTokenTarget} soft / ${config.sync.hardTokenBudget} hard tokens`)
    console.log(`Parallel: ${config.sync.concurrency}`)
  }
  console.log()

  switch (args.mode) {
    case 'estimate': {
      const estimate = await estimateCost(config)

      printEstimate(estimate, config)
      break
    }

    case 'query':
      if (!args.query) throw new Error('--query requires text')
      await runQuery(config, args.query, args.topK ?? 5, { onSaleOnly: args.onSaleOnly })
      break

    case 'fresh':
      await runSync(config, { fresh: true, limit: args.limit })
      break

    case 'retry':
      await runRetry(config)
      break

    case 'sync':
    default:
      await runSync(config, { limit: args.limit })
      break
  }
}

main().catch((error) => {
  console.error()
  console.error('✗ Fatal error:', error instanceof Error ? error.message : String(error))
  if (error instanceof Error && error.stack) {
    console.error(error.stack)
  }
  process.exit(1)
})
