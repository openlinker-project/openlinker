/**
 * Top products types
 *
 * Mirrors `apps/api/src/analytics/http/dto/top-products-*.dto.ts` (#1988).
 * Money column note (see the #1991 implementation plan § 4): the backend
 * `revenue` figure is a comparable, reporting-currency, FX-stamped-orders-only
 * sum — the same gross figure `sales-analytics.types.ts`'s `ChannelSalesAnalytics.revenue`
 * is, not the "Net sales" (VAT- and returns-netted) figure the design mockup's
 * copy names. This component renders it as "Revenue", matching the label the
 * sibling by-channel table (#1990) already settled on for the identical figure.
 *
 * @module features/analytics/api
 */
export interface ProductChannelSales {
  sourceConnectionId: string;
  units: number;
  revenue: number;
  unconvertedRevenue: number;
  currency: string | null;
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
