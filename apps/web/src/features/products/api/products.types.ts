/**
 * Products Feature Types
 *
 * Frontend transport types for the products API. Mirrors the backend
 * ProductResponseDto and ProductVariantResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/products/api
 */

export interface ExternalIdMapping {
  externalId: string;
  platformType: string;
  connectionId: string;
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string | null;
  attributes: Record<string, string> | null;
  ean: string | null;
  gtin: string | null;
  createdAt: string;
  updatedAt: string;
  externalIds?: ExternalIdMapping[];
}

export interface Product {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  /** ISO 4217 currency code (e.g., 'PLN', 'EUR'). Null when the backend has not populated a currency for this product. */
  currency: string | null;
  description: string | null;
  images: string[] | null;
  createdAt: string;
  updatedAt: string;
  variants?: ProductVariant[];
  externalIds?: ExternalIdMapping[];
}

export interface ProductFilters {
  search?: string;
}

export interface ProductPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedProducts {
  items: Product[];
  total: number;
  limit: number;
  offset: number;
}

export interface PaginatedProductVariants {
  items: ProductVariant[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Lightweight variant projection returned by `GET /products/variants/:id`.
 * Used by the listing-detail page (#464) to surface the linked variant's
 * SKU/EAN inline next to the Internal ID row.
 */
export interface ProductVariantSummary {
  id: string;
  productId: string;
  sku: string | null;
  ean: string | null;
  /** Display label assembled from variant attributes (e.g. "Red / 42"). */
  name?: string;
}
