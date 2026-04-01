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
 * Fetch image and convert to base64 data URI.
 */
async function imageToDataUri(url: string): Promise<string | null> {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 })
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

        // Fetch images and embed as base64 data URIs (CSP blocks external URLs in iframe)
        const productsWithImages = await Promise.all(
          result.products.map(async (p) => {
            // Request larger image from VTEX CDN (replace -55-55 thumbnail with -500-500)
            const imageUrl = p.image?.replace(/-\d+-\d+\//, '-500-500/') || p.image
            const dataUri = imageUrl ? await imageToDataUri(imageUrl) : null
            return { ...p, image: dataUri || undefined }
          })
        )

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
