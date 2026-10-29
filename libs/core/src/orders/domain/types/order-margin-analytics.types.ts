/**
 * Order Margin Analytics Types
 *
 * Shapes for the margin read (#3588, epic #3516, D27): gross margin on NET
 * (VAT-exclusive) revenue, against the per-line cost snapshot taken at
 * ingestion. Built on the same #1985 `order_line_items` read model and the
 * same Net Sales eligibility as the top-products NET figure (G11-E: no
 * returns subtraction), so `netRevenue` here equals the top-products net
 * revenue for the same range.
 *
 * A line contributes to margin only when it is both in net revenue and
 * "covered": a recorded cost in the order's own native currency (G11-C).
 * Every other net-revenue line is a GAP with exactly one reason, so
 * `coveredNetRevenue + sum(gaps.netAmount) = netRevenue` always holds.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { MarginGapReason } from '../order-line-cost-snapshot';
import type { SalesAnalyticsFilters } from './order-sales-analytics.types';

export const MarginBucketValues = ['day', 'week'] as const;
export type MarginBucket = (typeof MarginBucketValues)[number];

export const MarginSortByValues = ['grossMargin', 'netRevenue', 'marginPct'] as const;
export type MarginSortBy = (typeof MarginSortByValues)[number];

/** One gap bucket: lines in net revenue that carry no usable cost, for one reason. */
export interface MarginGapSum {
  reason: MarginGapReason;
  lineCount: number;
  /** Net revenue (reporting currency) of those lines. */
  netAmount: number;
}

/**
 * The additive part of every margin figure. Everything here sums across rows,
 * which is what lets the pure fold build day, week, channel and headline
 * views from the same repository rows.
 */
export interface MarginSums {
  /** Net (VAT-exclusive) revenue in the reporting currency, as in top-products. */
  netRevenue: number;
  /** Net revenue of covered lines only (recorded cost in the order's native currency). */
  coveredNetRevenue: number;
  /** `unitCostNet * quantity * fx` over covered lines (reporting currency). */
  costOfGoods: number;
  /** Always all four reasons, in `MarginGapReasonValues` order. */
  gaps: MarginGapSum[];
  /** In-scope lines left out of net revenue altogether (unstamped, zero total, net-ineligible). */
  excludedLineCount: number;
}

/** One margin figure set, as returned to callers. */
export interface MarginFigures {
  netRevenue: number;
  coveredNetRevenue: number;
  costOfGoods: number;
  /** `coveredNetRevenue - costOfGoods`. */
  grossMargin: number;
  /** `grossMargin / coveredNetRevenue`, `null` when nothing is covered. */
  marginPct: number | null;
  /** `coveredNetRevenue / netRevenue`, `null` when there is no net revenue. */
  costCoveragePct: number | null;
  gaps: MarginGapSum[];
}

/** Daily repository row: UTC day (`YYYY-MM-DD`) x source connection. */
export interface MarginDailyRow extends MarginSums {
  day: string;
  sourceConnectionId: string;
}

export interface MarginProductRow extends MarginSums {
  productId: string;
}

/** `variantId: null` is the lines that never resolved to a variant. */
export interface MarginVariantRow extends MarginSums {
  variantId: string | null;
}

export interface MarginTrendPoint extends MarginFigures {
  /** First covered UTC day of the bucket, `YYYY-MM-DD` (the ISO Monday for `week`). */
  date: string;
}

export interface MarginChannel extends MarginFigures {
  sourceConnectionId: string;
  /** Share of the headline net revenue, 0..1; `null` when the headline has none. */
  revenueShare: number | null;
}

export interface MarginAnalytics {
  /** The reporting currency every amount is expressed in. */
  currency: string;
  bucket: MarginBucket;
  headline: MarginFigures;
  trend: MarginTrendPoint[];
  channels: MarginChannel[];
  excludedLineCount: number;
}

export interface MarginProductFilters extends SalesAnalyticsFilters {
  sortBy: MarginSortBy;
  limit: number;
  offset: number;
}

export interface MarginProductView extends MarginFigures {
  productId: string;
}

export interface MarginProductsResult {
  currency: string;
  items: MarginProductView[];
  total: number;
}

export interface MarginVariantView extends MarginFigures {
  variantId: string | null;
}

export interface MarginProductVariantsResult {
  currency: string;
  productId: string;
  variants: MarginVariantView[];
}
