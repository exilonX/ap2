/**
 * Simplified product types for AI consumption
 * These are much lighter than VTEX's native product objects
 */

export interface SimpleProduct {
  sku: string;
  name: string;
  price: number;           // In store currency (e.g., dollars), NOT cents
  originalPrice?: number;  // If on sale, shows the crossed-out price
  image?: string;          // Primary product image URL
  available: boolean;      // In stock or not
  category?: string;       // Main category name
  brand?: string;          // Brand name
  description?: string;    // Short description (truncated for tokens)
}

export interface ProductSearchResult {
  products: SimpleProduct[];
  total: number;           // Total matching products (for pagination)
  query: string;           // The search query used
}

export interface ProductDetail extends SimpleProduct {
  images: string[];        // All product images
  fullDescription?: string;
  specifications?: Record<string, string>;
  variants?: ProductVariant[];
}

export interface ProductVariant {
  sku: string;
  name: string;            // e.g., "Size 10 - Black"
  price: number;
  available: boolean;
  attributes: Record<string, string>;  // e.g., { size: "10", color: "Black" }
}
