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
  /**
   * The variant's OWN tax-rate override (#2255). `null` means NO OVERRIDE - the
   * product's rate applies - never "no rate". Only a master that keys tax per
   * variant sets it, so on PrestaShop every variant is null and the product's
   * rate is the answer.
   */
  taxRate?: string | null;
  taxRateCountry?: string | null;
  taxRateReadAt?: string | null;
  /**
   * Why the shop named no rate for this variant's own override (#2264),
   * meaningful only alongside `taxRate: null` and a set `taxRateReadAt`.
   */
  taxRateUnknownReason?: TaxRateUnknownReason | null;
  createdAt: string;
  updatedAt: string;
  externalIds?: ExternalIdMapping[];
  /**
   * Whether this variant was deleted at the master (#1599) — absent from the
   * master catalog, or the product itself 404s. Its offers are auto-paused.
   */
  isStale: boolean;
  /** Timestamp of the most recent stale-marking; null while the variant is live. */
  staleAt: string | null;
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
  /**
   * Source-platform product-level attributes (#1752), e.g. Brand / Material.
   * Distinct from variant-distinguishing attributes (which show per-variant in
   * the stock drawer). Absent/empty until a sync populates them.
   */
  features?: { name: string; value: string }[];
  /**
   * Neutral tax-rate code the shop stated (#2255), or `null` when it stated
   * none. Paired with `taxRateReadAt`, which is what separates "the shop has no
   * rate" from "nobody has asked yet" - the two need different remedies.
   */
  taxRate?: string | null;
  taxRateCountry?: string | null;
  taxRateReadAt?: string | null;
  /**
   * Why the shop named no rate (#2264), meaningful only alongside
   * `taxRate: null` and a set `taxRateReadAt`. `null`/absent means no reason
   * was recorded - never "not-configured", a real answer the shop gave.
   */
  taxRateUnknownReason?: TaxRateUnknownReason | null;
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
  /**
   * Number of the product's variants deleted at the master (#1599, list only).
   * Compare against `variantCount` to tell "some deleted" apart from "all
   * deleted" (#2447).
   */
  staleVariantCount?: number;
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
  /**
   * Tax-rate read state (#2255). `missing` is the population that holds
   * documents; `not-checked` needs a product sync rather than a catalogue edit,
   * and on the day the feature ships it is the whole catalogue. Keeping them
   * apart is what stops day one reading as a catalogue-wide failure.
   */
  taxRateState?: 'missing' | 'not-checked' | 'known';
  /** Hide products where every variant is deleted at the master (#1599/#2447). */
  hideFullyStale?: boolean;
}

/**
 * Why the shop named no rate (#2264). Mirrors
 * `TaxRateUnknownReasonValues` in `libs/core/src/products/domain/types/tax-rate.types.ts` -
 * the frontend bundle cannot depend on `@openlinker/core` (#591).
 */
export const TaxRateUnknownReasonValues = ['not-configured', 'ambiguous', 'unreadable'] as const;
export type TaxRateUnknownReason = (typeof TaxRateUnknownReasonValues)[number];

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
  /** Whether this variant was deleted at the master (#1599). */
  isStale: boolean;
  /** Timestamp of the most recent stale-marking; null while the variant is live. */
  staleAt: string | null;
}
