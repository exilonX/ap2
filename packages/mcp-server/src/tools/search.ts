/**
 * Search Tools
 *
 * MCP tools for product discovery.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { readFileSync } from 'fs'
import { join } from 'path'
import { VtexClient } from '../client'
import type { ProductSearchResult, ProductDetail } from '@acg/shared/product'

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

        // Issue 0011 fix — return CDN URLs directly. The previous
        // base64-embedding loop (per-product axios fetch + Promise.all)
        // was blocking the tool result past the MCP App iframe's
        // delivery window for some calls, leaving widgets stuck on
        // "Loading products...". The iframe loads `<img>` tags
        // straight from `*.vteximg.com.br` (allow-listed in
        // `_meta.ui.csp.resourceDomains` below). We still upscale the
        // CDN path from -55-55 thumbnails to -500-500 for layout.
        const productsWithUpscaledImages = result.products.map((p) => {
          const imageUrl = p.image?.replace(/-\d+-\d+\//, '-500-500/') || p.image
          return { ...p, image: imageUrl }
        })

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ ...result, products: productsWithUpscaledImages }),
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
