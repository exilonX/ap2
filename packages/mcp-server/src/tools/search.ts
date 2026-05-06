/**
 * Search Tools
 *
 * MCP tools for product discovery.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import axios from 'axios'
import { VtexClient } from '../client'
import type { ProductSearchResult, ProductDetail } from '@acg/shared/product'

/**
 * Issue 0011 — fetch image, embed as base64 data URI, but with a STRICT
 * per-image timeout. The MCP App iframe CSP blocks `<img src=https://…>`
 * to external CDNs at runtime (the `_meta.ui.csp.resourceDomains` field
 * is advisory, not enforcing) — so we *must* embed images for them to
 * render. The original implementation used a 5s timeout and `Promise.all`,
 * which let one slow image block the entire tool result past the
 * iframe's tool-result delivery window. This version uses 1.5s per
 * image plus `Promise.allSettled` — one slow image can't block the
 * others, total tool time is bounded to ~1.5s, and failed images become
 * `undefined` (card renders without an image, no broken icon).
 */
const IMAGE_TIMEOUT_MS = 1500

async function imageToDataUri(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: IMAGE_TIMEOUT_MS,
    })
    const contentType = (response.headers['content-type'] || 'image/jpeg').split(';')[0]
    const base64 = Buffer.from(response.data).toString('base64')
    return `data:${contentType};base64,${base64}`
  } catch {
    return null
  }
}

const PRODUCTS_APP_URI = 'ui://acg-products/index.html'

export function registerSearchTools(server: McpServer, client: VtexClient) {
  // Register products MCP App resource
  let productsHtml: string
  try {
    productsHtml = readFileSync(join(__dirname, '..', 'apps', 'products.html'), 'utf-8')
  } catch {
    try {
      productsHtml = readFileSync(join(__dirname, '..', '..', 'src', 'apps', 'products.html'), 'utf-8')
    } catch {
      productsHtml = '<html><body><p>Products app not found</p></body></html>'
    }
  }

  server.resource(
    PRODUCTS_APP_URI, PRODUCTS_APP_URI,
    { mimeType: 'text/html;profile=mcp-app' },
    async () => ({
      contents: [{ uri: PRODUCTS_APP_URI, mimeType: 'text/html;profile=mcp-app', text: productsHtml }],
    })
  )

  // Visual product search — renders product cards with images in chat
  const browseProductsTool = server.tool(
    'browseProducts',
    'Search and browse products visually with images, prices, and add-to-cart buttons.',
    {
      query: z.string().describe('Search query'),
      maxResults: z.number().optional().describe('Max results (default: 5)'),
    },
    async (params) => {
      try {
        const searchParams: Record<string, string> = {
          q: params.query,
          limit: String(params.maxResults || 5),
        }
        const result = await client.get<ProductSearchResult>('/search', searchParams)

        // Issue 0011 — embed images as base64 with strict per-image
        // timeout (allSettled: one slow image can't block the rest;
        // 1.5s cap: total tool time bounded). MCP App iframe CSP
        // blocks external `<img src=https://…>` at runtime, so embedding
        // is load-bearing. Failed images fall through to undefined and
        // the iframe renders the card without an image (no broken icon).
        const settled = await Promise.allSettled(
          result.products.map(async (p) => {
            // Use VTEX's on-the-fly CDN resize. The regex inserts
            // -150-150 if no dimensions exist (miniprix URL shape) OR
            // replaces existing dimensions (other VTEX merchants).
            // 150×150 is plenty for product cards and 10-20× smaller
            // than full-res — keeps base64 payloads tiny so the MCP
            // stdio pipe stays drained.
            const imageUrl = p.image?.replace(/\/ids\/(\d+)(?:-\d+-\d+)?\//, '/ids/$1-150-150/') || p.image
            const dataUri = imageUrl ? await imageToDataUri(imageUrl) : null
            return { ...p, image: dataUri || undefined }
          })
        )
        const productsWithImages = settled.map((outcome, i) => {
          if (outcome.status === 'fulfilled') return outcome.value
          // Defensive — imageToDataUri swallows its own errors so this
          // branch shouldn't fire, but if it does, drop the image.
          return { ...result.products[i], image: undefined }
        })

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ ...result, products: productsWithImages }),
          }],
        }
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ error: error instanceof Error ? error.message : 'Search failed' }),
          }],
          isError: true,
        }
      }
    }
  )

  // Set _meta.ui for MCP App rendering, allow VTEX image CDN
  browseProductsTool._meta = {
    ui: {
      resourceUri: PRODUCTS_APP_URI,
      csp: {
        resourceDomains: ['vtexeurope.vteximg.com.br', '*.vteximg.com.br', 'vteximg.com.br'],
      },
    },
  } as any

  // searchProducts and getProductDetails commented out — browseProducts replaces them
  // with visual MCP App rendering. Uncomment if text-only search is needed.
}
