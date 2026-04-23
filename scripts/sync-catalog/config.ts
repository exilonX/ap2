/**
 * Config loader — JSON file first, env var fallback, CLI override.
 *
 * Loading order:
 *   1. --config <path> flag → load that file
 *   2. ./config.json in the script directory → load it
 *   3. Fall back to env vars (useful for CI)
 *   4. CLI flags override config values
 *   5. Validate schema, fail fast
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import type { Config } from './types.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DEFAULT_CONFIG_PATH = resolve(__dirname, 'config.json')

// Defaults for optional fields
const DEFAULTS = {
  sync: {
    concurrency: 20,
    batchSize: 100,
    hardTokenBudget: 1000,
    softTokenTarget: 500,
    throttleMs: 200,
  },
  openai: {
    model: 'text-embedding-3-small',
    dimensions: 512,
  },
  vtex: {
    workspace: 'master',
    salesChannel: 1,
    locale: 'pt-BR',
  },
  pinecone: {
    namespace: 'products',
  },
}

interface LoadOptions {
  configPath?: string
  concurrencyOverride?: number
}

export async function loadConfig(options: LoadOptions = {}): Promise<Config> {
  const path = options.configPath
    ? resolve(process.cwd(), options.configPath)
    : DEFAULT_CONFIG_PATH

  let fileConfig: Partial<Config> = {}

  try {
    const content = await readFile(path, 'utf-8')

    fileConfig = JSON.parse(content) as Partial<Config>
    console.log(`✓ Loaded config from ${path}`)
  } catch (error) {
    const isMissing = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'

    if (options.configPath) {
      // User specified a path — must exist
      throw new Error(`Config file not found: ${path}`)
    }

    if (!isMissing) {
      throw new Error(`Failed to read config at ${path}: ${error instanceof Error ? error.message : String(error)}`)
    }

    console.log(`ℹ No config.json found, falling back to env vars`)
  }

  // Merge env vars as fallbacks
  const config: Config = {
    vtex: {
      account: fileConfig.vtex?.account ?? process.env.VTEX_ACCOUNT ?? '',
      workspace: fileConfig.vtex?.workspace ?? process.env.VTEX_WORKSPACE ?? DEFAULTS.vtex.workspace,
      appKey: fileConfig.vtex?.appKey ?? process.env.VTEX_APP_KEY ?? '',
      appToken: fileConfig.vtex?.appToken ?? process.env.VTEX_APP_TOKEN ?? '',
      salesChannel: fileConfig.vtex?.salesChannel ?? Number(process.env.VTEX_SALES_CHANNEL ?? DEFAULTS.vtex.salesChannel),
      locale: fileConfig.vtex?.locale ?? process.env.VTEX_LOCALE ?? DEFAULTS.vtex.locale,
    },
    openai: {
      apiKey: fileConfig.openai?.apiKey ?? process.env.OPENAI_API_KEY ?? '',
      model: fileConfig.openai?.model ?? DEFAULTS.openai.model,
      dimensions: fileConfig.openai?.dimensions ?? DEFAULTS.openai.dimensions,
    },
    pinecone: {
      apiKey: fileConfig.pinecone?.apiKey ?? process.env.PINECONE_API_KEY ?? '',
      indexHost: fileConfig.pinecone?.indexHost ?? process.env.PINECONE_INDEX_HOST ?? '',
      namespace: fileConfig.pinecone?.namespace ?? DEFAULTS.pinecone.namespace,
    },
    sync: {
      concurrency: options.concurrencyOverride ?? fileConfig.sync?.concurrency ?? DEFAULTS.sync.concurrency,
      batchSize: fileConfig.sync?.batchSize ?? DEFAULTS.sync.batchSize,
      hardTokenBudget: fileConfig.sync?.hardTokenBudget ?? DEFAULTS.sync.hardTokenBudget,
      softTokenTarget: fileConfig.sync?.softTokenTarget ?? DEFAULTS.sync.softTokenTarget,
      throttleMs: fileConfig.sync?.throttleMs ?? DEFAULTS.sync.throttleMs,
    },
  }

  validateConfig(config)

  return config
}

function validateConfig(config: Config): void {
  const errors: string[] = []

  if (!config.vtex.account) errors.push('vtex.account is required')
  if (!config.vtex.appKey) errors.push('vtex.appKey is required')
  if (!config.vtex.appToken) errors.push('vtex.appToken is required')
  if (!config.openai.apiKey) errors.push('openai.apiKey is required')
  if (!config.pinecone.apiKey) errors.push('pinecone.apiKey is required')
  if (!config.pinecone.indexHost) errors.push('pinecone.indexHost is required')

  if (config.sync.concurrency < 1 || config.sync.concurrency > 100) {
    errors.push('sync.concurrency must be between 1 and 100')
  }

  if (config.sync.hardTokenBudget < config.sync.softTokenTarget) {
    errors.push('sync.hardTokenBudget must be >= softTokenTarget')
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid config:\n  - ${errors.join('\n  - ')}\n\n` +
      `Copy config.example.json to config.json and fill in your credentials,\n` +
      `or set env vars (VTEX_ACCOUNT, VTEX_APP_KEY, VTEX_APP_TOKEN, OPENAI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_HOST).`
    )
  }
}
