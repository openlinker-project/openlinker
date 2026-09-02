/**
 * Top products types
 *
 * Mirrors `apps/api/src/analytics/http/dto/top-products-*.dto.ts` (#1988).
 * Money column note (see the #1991 implementation plan § 4 and the
 * net-sales-tax-rate plan): the backend `revenue` figure is a comparable,
 * reporting-currency, FX-stamped-orders-only sum — GMV, not net. `netRevenue`
 * (net-sales tax-rate epic) is the VAT-exclusive counterpart, still gross of
 * returns/refunds (no such entity exists yet). `product-sales-table.tsx`
 * renders only `netRevenue`, labeled "Net sales" — unlike the by-channel
 * table, which shows GMV and Net sales as two separate columns.
 *
 * @module features/analytics/api
 */
export interface ProductChannelSales {
  sourceConnectionId: string;
  units: number;
  revenue: number;
  unconvertedRevenue: number;
  currency: string | null;
  netRevenue: number;
  netExcludedRevenue: number;
  netExcludedLineCount: number;
}

export interface TopProductRow {
  productId: string;
  /** `null` when the id didn't resolve to a live catalogue entry — never dropped, per #1988. */
  name: string | null;
  sku: string | null;
  units: number;
  /** Comparable, reporting-currency revenue — FX-stamped orders only. */
  revenue: number;
  unconvertedRevenue: number;
  unconvertedOrderCount: number;
  currency: string | null;
  /** The one native currency `unconvertedRevenue` is expressed in, or `null` when it mixes currencies (or is `0`). */
  unconvertedCurrency: string | null;
  channels: ProductChannelSales[];
  /** Listing-capable connections where this product has sales but no listed variant. */
  missingFromConnectionIds: string[];
  /** VAT-exclusive counterpart of `revenue` (net-sales tax-rate epic) — see the module doc comment. */
  netRevenue: number;
  /** Comparable sum for lines excluded from `netRevenue` due to an unresolvable tax rate. */
  netExcludedRevenue: number;
  /** Count of lines contributing to `netExcludedRevenue`. */
  netExcludedLineCount: number;
}

export interface TopProductsResult {
  items: TopProductRow[];
  /** Distinct products matching scope, before pagination. */
  total: number;
  unresolvedProductCount: number;
  /**
   * `false` when the coverage-gap enrichment failed for this whole response
   * — every row's `missingFromConnectionIds` is then an unreliable `[]`,
   * never evidence the product is listed everywhere. A consumer rendering
   * "Not listed"/"Publish" off `missingFromConnectionIds` MUST suppress
   * that treatment when this is `false` (#2172 review, IMPORTANT 1).
   */
  coverageGapAvailable: boolean;
}

export const TopProductsSortByValues = ['revenue', 'units'] as const;
export type TopProductsSortBy = (typeof TopProductsSortByValues)[number];

export interface TopProductsFilters {
  /** Inclusive `yyyy-mm-dd`, matches the toolbar's `date-range.lib.ts`. */
  from: string;
  /** Inclusive `yyyy-mm-dd` — converted to an exclusive instant in `top-products.api.ts`. */
  to: string;
  sourceConnectionId?: string;
  sortBy: TopProductsSortBy;
  limit: number;
  offset: number;
}

/**
 * One product's sales split by variant, per channel (#2765) — mirrors
 * `apps/api/src/analytics/http/dto/top-product-variants-response.dto.ts`.
 * Fetched lazily, only when a Top Products row is expanded — never part of
 * `TopProductsResult` above, see `use-top-product-variant-sales-query.ts`.
 */
export interface VariantChannelSales {
  sourceConnectionId: string;
  units: number;
  revenue: number;
  unconvertedRevenue: number;
  currency: string | null;
  unconvertedCurrency: string | null;
  netRevenue: number;
  netExcludedRevenue: number;
  netExcludedLineCount: number;
}

export interface TopProductVariantRow {
  /** `null` is the "Unassigned" bucket — order lines that never resolved to a variant. Never merged into a real variant unless the product has exactly one. */
  variantId: string | null;
  sku: string | null;
  attributes: Record<string, string> | null;
  /** Current available quantity across all locations. `null` for the "Unassigned" bucket, or when the stock read failed/couldn't resolve this variant. */
  totalAvailable: number | null;
  units: number;
  revenue: number;
  unconvertedRevenue: number;
  unconvertedOrderCount: number;
  currency: string | null;
  unconvertedCurrency: string | null;
  channels: VariantChannelSales[];
  netRevenue: number;
  netExcludedRevenue: number;
  netExcludedLineCount: number;
}

export interface TopProductVariantsResult {
  productId: string;
  variants: TopProductVariantRow[];
}
