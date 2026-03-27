/**
 * Search Tools
 *
 * MCP tools for product discovery.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod/v4'
import { VtexClient } from '../client'

// Types (will import from @acg/shared once built)
interface ProductSearchResult {
  products: Array<{
    sku: string
    name: string
    price: number
    originalPrice?: number
    image?: string
    available: boolean
    category?: string
    brand?: string
  }>
  total: number
  query: string
}

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

        // Format for Claude
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

        const productList = result.products
          .map((p, i) => {
            let line = `${i + 1}. **${p.name}** - $${p.price.toFixed(2)}`
            if (p.originalPrice && p.originalPrice > p.price) {
              line += ` (was $${p.originalPrice.toFixed(2)})`
            }
            if (!p.available) {
              line += ' [OUT OF STOCK]'
            }
            line += `\n   SKU: ${p.sku}`
            if (p.brand) {
              line += ` | Brand: ${p.brand}`
            }
            return line
          })
          .join('\n\n')

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
        const product = await client.get<{
          sku: string
          name: string
          price: number
          description?: string
          available: boolean
          images: string[]
          specifications?: Record<string, string>
        }>(`/product/${params.sku}`)

        let details = `**${product.name}**\n`
        details += `Price: $${product.price.toFixed(2)}\n`
        details += `SKU: ${product.sku}\n`
        details += `Availability: ${product.available ? 'In Stock' : 'Out of Stock'}\n`

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
