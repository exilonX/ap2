/**
 * VTEX Intelligent Search client.
 *
 * This is the endpoint the storefront actually uses to find products.
 * It returns ONLY active, visible, in-channel products — no post-filter needed.
 *
 * Docs: https://developers.vtex.com/docs/api-reference/intelligent-search-api
 *
 * Key quirks:
 *   - 2500-result HARD CAP on any single query (including paginated)
 *   - No auth required — it's public
 *   - `operator` and `fuzzy` are decided dynamically; reuse them for pagination
 *   - To get >2500 products, walk by category/brand facets (each facet < 2500)
 */

import type { AxiosInstance } from 'axios'

import type { VTEXProduct } from '../types.ts'
import { createHttpClient } from '../utils.ts'

// ─── Response shapes ───────────────────────────────────────────

export interface IntelligentSearchProduct {
  productId: string
  productName: string
  brand: string
  brandId: number
  linkText: string
  productReference: string
  description?: string
  categoryId: string
  categories: string[]
  categoriesIds: string[]
  items?: VTEXProduct['items']
  [key: string]: unknown
}

export interface ProductSearchResponse {
  products: IntelligentSearchProduct[]
  recordsFiltered: number
  pagination: {
    count: number
    current: { index: number }
    perPage: number
    next: { index: number } | null
    previous: { index: number } | null
    last: { index: number }
  }
  operator: string
  fuzzy: string
  correction?: { misspelled: boolean; text: string; correction: string }
  locale: string
  query: string
}

interface FacetValue {
  key: string     // slug — used in facet path
  value: string   // display name
  quantity: number
  selected: boolean
  link: string
  href: string
  children?: FacetValue[]
}

interface FacetsResponse {
  facets: Array<{
    name: string
    type: string      // 'CATEGORYTREE', 'TEXT', 'PRICERANGE', etc.
    values: FacetValue[]
  }>
}

/**
 * Category tree node from /api/catalog_system/pub/category/tree
 */
interface CategoryTreeNode {
  id: number
  name: string
  hasChildren: boolean
  url: string       // e.g. https://{account}.vtexcommercestable.com.br/femei/imbracaminte/bluze
  children: CategoryTreeNode[]
}

// ─── Client ────────────────────────────────────────────────────

export class IntelligentSearchClient {
  private readonly http: AxiosInstance
  private readonly locale: string

  constructor(account: string, locale = 'pt-BR') {
    this.http = createHttpClient({
      baseURL: `https://${account}.vtexcommercestable.com.br/api/io/_v/api/intelligent-search`,
      timeoutMs: 20_000,
    })
    this.locale = locale
  }

  /**
   * Search products. Returns paginated results (max 50 per page).
   *
   * IMPORTANT: VTEX Intelligent Search uses 1-INDEXED pagination.
   * page=1 = first page. page=0 returns 400 "Page should be greater than 0".
   *
   * Hard cap of 2500 across all pages for a single query/facet combination
   * (so max ~50 pages at count=50).
   */
  async productSearch(params: {
    query?: string
    facets?: string
    page: number    // 1-indexed
    count?: number
    sort?: string
    hideUnavailableItems?: boolean
    operator?: string | null
    fuzzy?: string | null
  }): Promise<ProductSearchResponse> {
    if (params.page < 1) {
      throw new Error(`Intelligent Search requires page >= 1, got ${params.page}`)
    }

    const search = new URLSearchParams()

    if (params.query) search.set('query', params.query)
    search.set('page', String(params.page))
    search.set('count', String(params.count ?? 50))
    search.set('locale', this.locale)
    if (params.sort) search.set('sort', params.sort)
    if (params.hideUnavailableItems) search.set('hideUnavailableItems', 'true')
    if (params.operator) search.set('operator', params.operator)
    if (params.fuzzy) search.set('fuzzy', params.fuzzy)

    const facetPath = params.facets ? `/${params.facets}` : ''
    const { data } = await this.http.get<ProductSearchResponse>(
      `/product_search${facetPath}?${search.toString()}`
    )

    return data
  }

  /**
   * Fetch facets for a given query/path. Used to discover categories, brands, etc.
   * and their product counts, so we can walk a large catalog in chunks < 2500.
   */
  async getFacets(facets = '', query = ''): Promise<FacetsResponse> {
    const search = new URLSearchParams()

    if (query) search.set('query', query)
    search.set('locale', this.locale)

    const facetPath = facets ? `/${facets}` : ''
    const { data } = await this.http.get<FacetsResponse>(
      `/facets${facetPath}?${search.toString()}`
    )

    return data
  }

  /**
   * Stream all active products using Intelligent Search.
   *
   * Simple strategy: paginate with empty query, up to 2500 results.
   * For catalogs > 2500 active products, caller should use streamByCategory.
   *
   * Yields one page of products at a time so caller can process incrementally.
   */
  async *streamAllProducts(options: { pageSize?: number; hideUnavailable?: boolean } = {}): AsyncGenerator<{
    products: IntelligentSearchProduct[]
    page: number
    recordsFiltered: number
    hitCap: boolean
  }> {
    const pageSize = options.pageSize ?? 50
    let page = 1 // Intelligent Search is 1-indexed
    let operator: string | null = null
    let fuzzy: string | null = null
    let totalSoFar = 0

    while (true) {
      const response = await this.productSearch({
        page,
        count: pageSize,
        hideUnavailableItems: options.hideUnavailable ?? false,
        operator,
        fuzzy,
      })

      if (page === 1) {
        operator = response.operator
        fuzzy = response.fuzzy
      }

      totalSoFar += response.products.length

      const hitCap = totalSoFar >= 2500 && response.products.length > 0

      yield {
        products: response.products,
        page,
        recordsFiltered: response.recordsFiltered,
        hitCap,
      }

      if (response.products.length < pageSize) break
      if (hitCap) break

      page++
    }
  }

  /**
   * Fetch the full category tree via the Catalog API.
   * Returns a nested tree up to `levels` deep (default 10 covers most stores).
   *
   * Uses the store host (not the /_v/api/intelligent-search path) since
   * this is a Catalog API endpoint.
   */
  async getCategoryTree(account: string, levels = 10): Promise<CategoryTreeNode[]> {
    const url = `https://${account}.vtexcommercestable.com.br/api/catalog_system/pub/category/tree/${levels}`
    const { data } = await (await import('axios')).default.get<CategoryTreeNode[]>(url)

    return data
  }

  /**
   * Walk a category tree and yield leaf paths for use as facet filters.
   *
   * Each leaf path is the URL slug chain from root to leaf,
   * e.g. "femei/imbracaminte/bluze---camasi/bluze" which combined with
   * `category-N/` prefixes becomes the Intelligent Search facet string.
   */
  collectLeafPaths(tree: CategoryTreeNode[]): Array<{
    slugPath: string[]          // e.g. ['femei', 'imbracaminte', 'bluze']
    name: string                // leaf display name
  }> {
    const leaves: Array<{ slugPath: string[]; name: string }> = []

    const walk = (nodes: CategoryTreeNode[], parentPath: string[]): void => {
      for (const node of nodes) {
        // Extract slug from URL (last path segment)
        const url = new URL(node.url)
        const urlParts = url.pathname.split('/').filter(Boolean)
        const slug = urlParts[urlParts.length - 1] ?? String(node.id)
        const currentPath = [...parentPath, slug]

        if (!node.hasChildren || node.children.length === 0) {
          leaves.push({ slugPath: currentPath, name: node.name })
        } else {
          walk(node.children, currentPath)
        }
      }
    }

    walk(tree, [])

    return leaves
  }

  /**
   * Build the Intelligent Search facet path from a category slug path.
   * ['femei', 'imbracaminte', 'bluze'] →
   *   'category-1/femei/category-2/imbracaminte/category-3/bluze'
   */
  buildCategoryFacetPath(slugPath: string[]): string {
    return slugPath.map((slug, i) => `category-${i + 1}/${slug}`).join('/')
  }

  /**
   * Stream all products by walking the real category tree.
   * Catalogs > 2500 active products need this to cover everything.
   *
   * Flow:
   *   1. Fetch full category tree from Catalog API
   *   2. For each leaf, build facet path, paginate Intelligent Search
   *   3. Yield products (caller dedupes by productId)
   */
  async *streamByCategoryWalk(
    account: string,
    options: { pageSize?: number; hideUnavailable?: boolean } = {}
  ): AsyncGenerator<{
    products: IntelligentSearchProduct[]
    categoryPath: string
    categoryName: string
    page: number
    categoryIndex: number
    totalCategories: number
  }> {
    const pageSize = options.pageSize ?? 50

    // 1. Fetch + flatten tree
    const tree = await this.getCategoryTree(account, 10)
    const leaves = this.collectLeafPaths(tree)

    // 2. Walk each leaf
    for (const [categoryIndex, leaf] of leaves.entries()) {
      const facetPath = this.buildCategoryFacetPath(leaf.slugPath)
      let page = 1 // 1-indexed
      let operator: string | null = null
      let fuzzy: string | null = null

      while (true) {
        let response
        try {
          response = await this.productSearch({
            facets: facetPath,
            page,
            count: pageSize,
            hideUnavailableItems: options.hideUnavailable ?? false,
            operator,
            fuzzy,
          })
        } catch {
          // Some leaves may 400 — skip them
          break
        }

        if (page === 1) {
          operator = response.operator
          fuzzy = response.fuzzy
        }

        if (response.products.length === 0) break

        yield {
          products: response.products,
          categoryPath: leaf.slugPath.join(' > '),
          categoryName: leaf.name,
          page,
          categoryIndex,
          totalCategories: leaves.length,
        }

        if (response.products.length < pageSize) break
        if (page >= 50) break // safety — the 2500 cap

        page++
      }
    }
  }
}
