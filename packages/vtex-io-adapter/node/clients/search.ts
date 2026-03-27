/**
 * Search Client
 *
 * Wraps VTEX Catalog Search API for product discovery.
 */

import { ExternalClient, InstanceOptions, IOContext } from '@vtex/api';


export interface VTEXProduct {
  productId: string;
  productName: string;
  brand: string;
  brandId: number;
  linkText: string;
  productReference: string;
  categoryId: string;
  productTitle: string;
  metaTagDescription: string;
  releaseDate: string;
  clusterHighlights: Record<string, string>;
  productClusters: Record<string, string>;
  searchableClusters: Record<string, string>;
  categories: string[];
  categoriesIds: string[];
  link: string;
  allSpecifications: string[];
  allSpecificationsGroups: string[];
  description: string;
  items: VTEXSku[];
}

export interface VTEXSku {
  itemId: string;
  name: string;
  nameComplete: string;
  complementName: string;
  ean: string;
  referenceId: Array<{ Key: string; Value: string }>;
  measurementUnit: string;
  unitMultiplier: number;
  modalType: string;
  isKit: boolean;
  images: Array<{
    imageId: string;
    imageLabel: string;
    imageTag: string;
    imageUrl: string;
    imageText: string;
  }>;
  sellers: Array<{
    sellerId: string;
    sellerName: string;
    addToCartLink: string;
    sellerDefault: boolean;
    commertialOffer: {
      DeliverySlaSamplesPerRegion: Record<string, unknown>;
      Installments: Array<{
        Value: number;
        InterestRate: number;
        TotalValuePlusInterestRate: number;
        NumberOfInstallments: number;
        PaymentSystemName: string;
        PaymentSystemGroupName: string;
        Name: string;
      }>;
      DiscountHighLight: unknown[];
      GiftSkuIds: unknown[];
      Teasers: unknown[];
      BuyTogether: unknown[];
      ItemMetadataAttachment: unknown[];
      Price: number;
      ListPrice: number;
      PriceWithoutDiscount: number;
      RewardValue: number;
      PriceValidUntil: string;
      AvailableQuantity: number;
      Tax: number;
      DeliverySlaSamples: unknown[];
      GetInfoErrorMessage: string | null;
      CacheVersionUsedToCallCheckout: string;
    };
  }>;
  variations: Array<{ name: string; values: string[] }>;
}

export class SearchClient extends ExternalClient {
  constructor(context: IOContext, options?: InstanceOptions) {
    super(`http://${context.account}.vtexcommercestable.com.br`, context, {
      ...options,
      headers: {
        ...options?.headers,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Vtex-Use-Https': 'true',
      },
    });
  }

  /**
   * Search products using VTEX Search API
   */
  public async searchProducts(
    query: string,
    limit: number = 10
  ): Promise<VTEXProduct[]> {
    // Using VTEX legacy search API
    // For Intelligent Search, would use different endpoint
    return this.http.get<VTEXProduct[]>(
      `/api/catalog_system/pub/products/search/${encodeURIComponent(query)}`,
      {
        params: {
          _from: 0,
          _to: limit - 1,
        },
        metric: 'acg-search',
      }
    );
  }

  /**
   * Get product by SKU
   */
  public async getProductBySku(sku: string): Promise<VTEXProduct | null> {
    try {
      const products = await this.http.get<VTEXProduct[]>(
        `/api/catalog_system/pub/products/search`,
        {
          params: {
            fq: `skuId:${sku}`,
          },
          metric: 'acg-product-detail',
        }
      );
      return products[0] || null;
    } catch {
      return null;
    }
  }
}
