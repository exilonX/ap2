/**
 * Tenant registry — maps a path tenant id (`/mcp/<tenant>`) to the VTEX
 * account + adapter secret the per-session VtexClient should use.
 *
 * One MCP service serves many merchants: the merchant is chosen by the URL the
 * customer's Claude connector points at (`mcp.host/mcp/vtexeurope`). Because
 * each MCP session already builds its OWN VtexClient (src/http.ts), binding it
 * to the tenant's config at session-init keeps merchants fully isolated — no
 * shared cart, no shared secret. See docs/REMOTE_MCP.md §3 (Phase 3).
 *
 * Sources (first match wins), each a JSON object keyed by tenant id:
 *   { "vtexeurope": { "account": "vtexeurope", "workspace": "master",
 *                     "acgAuthToken": "…", "appKey": "…", "appToken": "…" } }
 *   1. ACG_TENANTS_JSON  — the JSON inline (handy for a single secret env var)
 *   2. ACG_TENANTS_FILE  — path to a JSON file (mount as a secret)
 *
 * Fallback: if no registry is configured, the single-merchant env config
 * (VTEX_ACCOUNT / ACG_AUTH_TOKEN / …) is registered as tenant "default", so a
 * plain single-tenant deploy keeps working at `/mcp` with no registry file.
 */

import { readFileSync } from 'node:fs'

import type { AcgMcpConfig } from './server'
import { loadConfigFromEnv } from './server'

interface RawTenant {
  account: string
  workspace?: string
  acgAuthToken?: string
  appKey?: string
  appToken?: string
}

export interface TenantRegistry {
  /** Resolve a tenant's config, or undefined if unknown. `undefined` id → "default". */
  get(tenant: string | undefined): AcgMcpConfig | undefined
  /** Registered tenant ids (for startup logging). */
  list(): string[]
}

function parseTenantsJson(): Record<string, RawTenant> | null {
  const inline = process.env.ACG_TENANTS_JSON

  if (inline && inline.trim()) {
    try {
      return JSON.parse(inline) as Record<string, RawTenant>
    } catch (err) {
      console.error(
        `[ACG] ACG_TENANTS_JSON is not valid JSON: ${
          err instanceof Error ? err.message : err
        }`
      )
    }
  }

  const file = process.env.ACG_TENANTS_FILE

  if (file && file.trim()) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as Record<string, RawTenant>
    } catch (err) {
      console.error(
        `[ACG] could not read ACG_TENANTS_FILE (${file}): ${
          err instanceof Error ? err.message : err
        }`
      )
    }
  }

  return null
}

function toConfig(raw: RawTenant): AcgMcpConfig {
  return {
    vtexAccount: raw.account,
    vtexWorkspace: raw.workspace ?? 'master',
    acgAuthToken: raw.acgAuthToken,
    vtexAppKey: raw.appKey,
    vtexAppToken: raw.appToken,
  }
}

export function loadTenantRegistry(): TenantRegistry {
  const map = new Map<string, AcgMcpConfig>()

  const raw = parseTenantsJson()

  if (raw) {
    for (const [id, cfg] of Object.entries(raw)) {
      if (cfg && typeof cfg.account === 'string' && cfg.account) {
        map.set(id.trim().toLowerCase(), toConfig(cfg))
      }
    }
  }

  // Single-merchant fallback → tenant "default" (so `/mcp` works with no file).
  if (!map.has('default')) {
    const envCfg = loadConfigFromEnv()

    if (envCfg.vtexAccount && envCfg.vtexAccount !== 'your-account') {
      map.set('default', envCfg)
    }
  }

  return {
    get(tenant) {
      return map.get((tenant ?? 'default').trim().toLowerCase())
    },
    list() {
      return [...map.keys()]
    },
  }
}
