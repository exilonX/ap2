/**
 * VTEX Catalog API client using axios.
 *
 * Primary discovery endpoint: stockkeepingunitidsbysaleschannel
 *   → returns ONLY active SKUs (the set that pub/products/search can find)
 *
 * Hydration endpoints:
 *   → pub/products/search?fq=skuId:X (batched, up to 50 per call)
 *   → pub/products/search?fq=productId:X (single product)
 */

import type { AxiosInstance } from 'axios'
import axios from 'axios'

import type {
  Config,
  GetProductAndSkuIdsResponse,
  VTEXProduct,
} from '../types.ts'
import { createHttpClient } from '../utils.ts'

export class VtexCatalogClient {
  private readonly http: AxiosInstance

  constructor(config: Config['vtex']) {
    this.http = createHttpClient({
      baseURL: `https://${config.account}.vtexcommercestable.com.br`,
      headers: {
        'X-VTEX-API-AppKey': config.appKey,
        'X-VTEX-API-AppToken': config.appToken,
      },
    })
  }

  /**
   * Fetch one page of ACTIVE SKU IDs for the given sales channel.
   * Response is a flat array of SKU IDs: [12345, 12346, ...]
   */
  async getActiveSkuIds(
    salesChannel: number,
    page: number,
    pageSize: number,
  ): Promise<number[]> {
    const { data } = await this.http.get<number[]>(
      '/api/catalog_system/pvt/sku/stockkeepingunitidsbysaleschannel',
      { params: { sc: salesChannel, page, pageSize } },
    )

    return data
  }

  /**
   * Stream all active SKU IDs across all pages.
   * Yields one page at a time so callers can process incrementally.
   *
   * Paginates until an empty or short page is returned.
   */
  async *streamActiveSkuIds(
    salesChannel: number,
    pageSize = 1000,
  ): AsyncGenerator<{
    ids: number[]
    page: number
    discoveredSoFar: number
  }> {
    let page = 1
    let discoveredSoFar = 0

    while (true) {
      const ids = await this.getActiveSkuIds(salesChannel, page, pageSize)

      if (ids.length === 0) break

      discoveredSoFar += ids.length

      yield { ids, page, discoveredSoFar }

      // Short page = end of catalog
      if (ids.length < pageSize) break

      page++
    }
  }

  /**
   * Fetch a page of productId → [skuIds] mapping.
   *
   * Important: GetProductAndSkuIds returns ALL products (active + inactive).
   * We use it ONLY for the SKU↔Product mapping. Active-ness is determined
   * by cross-referencing with stockkeepingunitidsbysaleschannel.
   *
   * Response: { data: { [productId]: [skuIds] }, range: { total, from, to } }
   * Max window: 250 per call.
   */
  async getProductAndSkuIds(
    from: number,
    to: number,
  ): Promise<GetProductAndSkuIdsResponse> {
    const { data } = await this.http.get<GetProductAndSkuIdsResponse>(
      '/api/catalog_system/pvt/products/GetProductAndSkuIds',
      { params: { _from: from, _to: to } },
    )

    return data
  }

  /**
   * Stream the full productId → [skuIds] mapping across all pages.
   * Used for building a SKU↔Product index before filtering to active products.
   */
  async *streamProductAndSkuIds(pageSize = 250): AsyncGenerator<{
    mappings: Record<string, number[]>
    total: number
    from: number
    to: number
  }> {
    let from = 0

    while (true) {
      const to = from + pageSize - 1
      const response = await this.getProductAndSkuIds(from, to)
      const total = response.range.total

      yield { mappings: response.data, total, from, to }

      if (to >= total - 1 || Object.keys(response.data).length === 0) {
        break
      }

      from = to + 1
    }
  }

  /**
   * Single product lookup — returns null on 404 or empty response.
   * Kept for --retry flow where we retry specific known product IDs.
   */
  async getProductById(productId: number): Promise<VTEXProduct | null> {
    try {
      const { data } = await this.http.get<VTEXProduct[]>(
        '/api/catalog_system/pub/products/search',
        { params: { fq: `productId:${productId}` } },
      )

      return data[0] ?? null
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null
      }

      throw error
    }
  }
}
