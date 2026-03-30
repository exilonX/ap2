/**
 * Product Mappers
 *
 * Transform heavy VTEX product objects into lightweight AI-friendly format.
 * VTEX product JSON can be 5KB+; we reduce to ~200 bytes.
 */

import type { VTEXProduct } from '../clients/search';
import type { SimpleProduct, ProductDetail } from '../types/shared';

/**
 * Map VTEX Product to SimpleProduct
 * Picks the first available SKU
 */
export function mapProduct(vtexProduct: VTEXProduct): SimpleProduct {
  // Find the best SKU (first available, or just first)
  const sku = vtexProduct.items.find((item) => {
    const seller = item.sellers?.[0];
    return seller?.commertialOffer?.AvailableQuantity > 0;
  }) || vtexProduct.items[0];

  if (!sku) {
    // Fallback if no items
    return {
      sku: vtexProduct.productId,
      name: vtexProduct.productName,
      price: 0,
      available: false,
      brand: vtexProduct.brand,
    };
  }

  const seller = sku.sellers?.[0];
  const offer = seller?.commertialOffer;

  // VTEX Search API returns prices in store currency (not cents)
  const price = offer?.Price || 0;
  const listPrice = offer?.ListPrice || 0;

  return {
    sku: sku.itemId,
    name: `${vtexProduct.productName}${sku.name !== vtexProduct.productName ? ` - ${sku.name}` : ''}`,
    price,
    originalPrice: listPrice > price ? listPrice : undefined,
    image: sku.images?.[0]?.imageUrl,
    available: (offer?.AvailableQuantity || 0) > 0,
    category: vtexProduct.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '').trim(),
    brand: vtexProduct.brand,
  };
}

/**
 * Map VTEX Product to detailed ProductDetail
 * Used for single product view
 */
export function mapProductDetail(
  vtexProduct: VTEXProduct,
  skuId?: string
): ProductDetail {
  // Find specific SKU or use first
  const sku = skuId
    ? vtexProduct.items.find((item) => item.itemId === skuId)
    : vtexProduct.items[0];

  if (!sku) {
    return {
      sku: vtexProduct.productId,
      name: vtexProduct.productName,
      price: 0,
      available: false,
      images: [],
      brand: vtexProduct.brand,
    };
  }

  const seller = sku.sellers?.[0];
  const offer = seller?.commertialOffer;

  // VTEX Search API returns prices in store currency (not cents)
  const price = offer?.Price || 0;
  const listPrice = offer?.ListPrice || 0;

  // Extract specifications from product
  const specifications: Record<string, string> = {};
  if (vtexProduct.allSpecifications) {
    vtexProduct.allSpecifications.forEach((spec) => {
      const value = (vtexProduct as unknown as Record<string, string[]>)[spec];
      if (value && Array.isArray(value)) {
        specifications[spec] = value.join(', ');
      }
    });
  }

  return {
    sku: sku.itemId,
    name: `${vtexProduct.productName}${sku.name !== vtexProduct.productName ? ` - ${sku.name}` : ''}`,
    price,
    originalPrice: listPrice > price ? listPrice : undefined,
    image: sku.images?.[0]?.imageUrl,
    images: sku.images?.map((img) => img.imageUrl) || [],
    available: (offer?.AvailableQuantity || 0) > 0,
    category: vtexProduct.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '').trim(),
    brand: vtexProduct.brand,
    description: vtexProduct.description
      ? truncateDescription(vtexProduct.description, 300)
      : undefined,
    specifications:
      Object.keys(specifications).length > 0 ? specifications : undefined,
  };
}

/**
 * Truncate description to save tokens
 */
function truncateDescription(text: string, maxLength: number): string {
  // Remove HTML tags
  const clean = text.replace(/<[^>]*>/g, '').trim();

  if (clean.length <= maxLength) {
    return clean;
  }

  // Truncate at word boundary
  const truncated = clean.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  return `${truncated.substring(0, lastSpace)}...`;
}
