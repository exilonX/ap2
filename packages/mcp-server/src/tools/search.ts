/**
 * Search Tools
 *
 * MCP tools for product discovery.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { VtexClient } from '../client'
import type { ProductSearchResult, ProductDetail } from '@acg/shared/product'

export function registerSearchTools(server: McpServer, client: VtexClient) {
  /**
   * Search for products in the store
   */
  server.tool(
    'searchProducts',
    {
      query: z.string().describe('Search query (e.g., "running shoes", "blue t-shirt")'),
      maxResults: z.number().optional().describe('Maximum number of results to return (default: 5)'),
      category: z.string().optional().describe('Filter by category (optional)'),
      minPrice: z.number().optional().describe('Minimum price filter (optional)'),
      maxPrice: z.number().optional().describe('Maximum price filter (optional)'),
    },
    async (params) => {
      try {
        const searchParams: Record<string, string> = {
          q: params.query,
          limit: String(params.maxResults || 5),
        }

        if (params.category) {
          searchParams.category = params.category
        }
        if (params.minPrice !== undefined) {
          searchParams.minPrice = String(params.minPrice)
        }
        if (params.maxPrice !== undefined) {
          searchParams.maxPrice = String(params.maxPrice)
        }

        const result = await client.get<ProductSearchResult>('/search', searchParams)

        if (result.products.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `No products found for "${params.query}". Try a different search term.`,
              },
            ],
          }
        }

        const cur = result.currency || 'EUR'

        const productList = result.products
          .map((p, i) => {
            let line = ''
            if (p.image) {
              line += `![${p.name}](${p.image})\n\n`
            }
            line += `**${i + 1}. ${p.name}**\n`
            line += `Price: ${p.price.toFixed(2)} ${cur}`
            if (p.originalPrice && p.originalPrice > p.price) {
              const discount = Math.round((1 - p.price / p.originalPrice) * 100)
              line += ` ~~${p.originalPrice.toFixed(2)} ${cur}~~ (-${discount}%)`
            }
            if (!p.available) {
              line += ' [OUT OF STOCK]'
            }
            line += `\nSKU: ${p.sku}`
            if (p.brand) {
              line += ` | Brand: ${p.brand}`
            }
            if (p.category) {
              line += ` | Category: ${p.category}`
            }
            return line
          })
          .join('\n\n---\n\n')

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${result.total} products for "${result.query}":\n\n${productList}`,
            },
          ],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error searching products: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )

  /**
   * Get detailed information about a specific product
   */
  server.tool(
    'getProductDetails',
    {
      sku: z.string().describe('The product SKU'),
    },
    async (params) => {
      try {
        const product = await client.get<ProductDetail>(`/product/${params.sku}`)

        let details = ''
        if (product.image) {
          details += `![${product.name}](${product.image})\n\n`
        }
        details += `**${product.name}**\n`
        details += `Price: ${product.price.toFixed(2)}`
        if (product.originalPrice && product.originalPrice > product.price) {
          const discount = Math.round((1 - product.price / product.originalPrice) * 100)
          details += ` ~~${product.originalPrice.toFixed(2)}~~ (-${discount}%)`
        }
        details += `\n`
        details += `SKU: ${product.sku}\n`
        details += `Availability: ${product.available ? 'In Stock' : 'Out of Stock'}\n`

        if (product.brand) {
          details += `Brand: ${product.brand}\n`
        }
        if (product.category) {
          details += `Category: ${product.category}\n`
        }

        if (product.description) {
          details += `\nDescription: ${product.description}\n`
        }

        if (product.specifications && Object.keys(product.specifications).length > 0) {
          details += `\nSpecifications:\n`
          for (const [key, value] of Object.entries(product.specifications)) {
            details += `- ${key}: ${value}\n`
          }
        }

        return {
          content: [{ type: 'text' as const, text: details }],
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error getting product details: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
          isError: true,
        }
      }
    }
  )
}
