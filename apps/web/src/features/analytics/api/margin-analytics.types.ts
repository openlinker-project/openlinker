/**
 * Margin analytics types
 *
 * Mirrors `apps/api/src/analytics/http/dto/margin-analytics-*.dto.ts`
 * (#3588, D27). Every amount is net (VAT-exclusive) in `currency`, the system
 * reporting currency. A ratio is `null` when its denominator is 0 - never
 * `0`, so "no covered revenue" cannot be read as "0% margin".
 *
 * @module features/analytics/api
 */
export const MARGIN_GAP_REASON_VALUES = [
  'no-cost',
  'cost-entered-after-sale',
  'no-variant',
  'currency-mismatch',
] as const;
export type MarginGapReason = (typeof MARGIN_GAP_REASON_VALUES)[number];

export const MARGIN_BUCKET_VALUES = ['day', 'week'] as const;
export type MarginBucket = (typeof MARGIN_BUCKET_VALUES)[number];

export const MARGIN_SORT_BY_VALUES = ['grossMargin', 'netRevenue', 'marginPct'] as const;
export type MarginSortBy = (typeof MARGIN_SORT_BY_VALUES)[number];

export interface MarginGap {
  reason: MarginGapReason;
  lineCount: number;
  netAmount: number;
}

export interface MarginFigures {
  netRevenue: number;
  coveredNetRevenue: number;
  costOfGoods: number;
  grossMargin: number;
  /** Ratio (0.43 = 43%), `null` when nothing is covered. */
  marginPct: number | null;
  /** Ratio, `null` when there is no net revenue. */
  costCoveragePct: number | null;
  gaps: MarginGap[];
}

export interface MarginTrendPoint extends MarginFigures {
  /** First covered UTC day of the bucket, `YYYY-MM-DD` (the ISO Monday for `week`). */
  date: string;
}

export interface MarginChannel extends MarginFigures {
  sourceConnectionId: string;
  revenueShare: number | null;
}

export interface MarginAnalytics {
  currency: string;
  bucket: MarginBucket;
  headline: MarginFigures;
  trend: MarginTrendPoint[];
  channels: MarginChannel[];
  excludedLineCount: number;
}

export interface MarginProductRow extends MarginFigures {
  productId: string;
  name: string | null;
  sku: string | null;
}

export interface MarginProductsResult {
  currency: string;
  items: MarginProductRow[];
  total: number;
  unresolvedProductCount: number;
}

export interface MarginFilters {
  /** Inclusive `yyyy-mm-dd`, converted to an exclusive instant in the api module. */
  from: string;
  to: string;
  sourceConnectionId?: string;
}

export interface MarginProductsFilters extends MarginFilters {
  sortBy: MarginSortBy;
  limit: number;
  offset: number;
}
