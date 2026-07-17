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
  /**
   * Master variant price. `null` until the master adapter populates the
   * column on the next sync (no historical backfill — see #792 PR 1).
   */
  price: number | null;
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
  /**
   * Source-platform external category ids (#1034), populated at product sync.
   * Threaded into the bulk-offer wizard's Resolve step so an EAN-no-match row
   * can still resolve its destination category via the configured
   * per-source-category mapping (#1522). Null/absent until a sync populates it.
   */
  categories?: string[] | null;
  createdAt: string;
  updatedAt: string;
  variants?: ProductVariant[];
  externalIds?: ExternalIdMapping[];
  /**
   * List-enrichment fields (#1720, cockpit list path only). Aggregated
   * master stock across the product's inventory rows plus per-connection
   * listings coverage; absent on payloads that predate the cockpit BE.
   */
  totalAvailable?: number;
  totalReserved?: number;
  stockUpdatedAt?: string | null;
  variantCount?: number;
  listingsCoverage?: ProductListingsCoverage[];
}

/** Per-connection listed-variant count for the cockpit Listings column (#1720). */
export interface ProductListingsCoverage {
  connectionId: string;
  platformType: string;
  listedVariants: number;
}

/** Qualitative stock filter values accepted by the products list (#1720). */
export const ProductStockFilterValues = ['out', 'low', 'oversold'] as const;
export type ProductStockFilter = (typeof ProductStockFilterValues)[number];

export interface ProductFilters {
  search?: string;
  /** Aggregate stock bucket: out (= 0), low (0 < total <= threshold), oversold (< 0). */
  stock?: ProductStockFilter;
  /** Products with >= 1 variant unlisted on at least one of these connections. */
  unlistedOn?: string[];
  /** Source filter: product has a Product identifier mapping for this connection. */
  connectionId?: string;
}

/** Server-side sort axes for the products list (#1720). */
export const ProductListSortFieldValues = [
  'name',
  'sku',
  'price',
  'createdAt',
  'updatedAt',
  'stock',
] as const;
export type ProductListSortField = (typeof ProductListSortFieldValues)[number];

export const ProductListSortDirValues = ['asc', 'desc'] as const;
export type ProductListSortDir = (typeof ProductListSortDirValues)[number];

export interface ProductListSort {
  field: ProductListSortField;
  dir: ProductListSortDir;
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
