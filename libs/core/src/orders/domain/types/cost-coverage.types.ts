/**
 * Cost Coverage Types
 *
 * Shapes for the reads behind the "Missing cost prices" screens (#3588, epic
 * #3516, mockup M30): how much of the last N days' net sales sits on variants
 * that still have no cost, which variants those are, and the work list an
 * operator walks to fill them in.
 *
 * "Without cost" means the variant CURRENTLY has no cost (`netUnitCost IS
 * NULL`) - that is what the banners and the work list say - whereas the margin
 * gap sums ({@link MarginGapSum}) classify each LINE by what was snapshotted at
 * ingestion. Both are reported so the screen can split "no cost" from "ordered
 * before the cost was entered".
 *
 * @module libs/core/src/orders/domain/types
 */
import type { MarginGapSum } from './order-margin-analytics.types';

export const CostWorklistTabValues = ['sold', 'all', 'has-cost'] as const;
export type CostWorklistTab = (typeof CostWorklistTabValues)[number];

/** Window of the work list's sales columns, in days (mockup: "Last 30 days"). */
export const COST_WORKLIST_SALES_WINDOW_DAYS = 30;

export const COST_COVERAGE_MIN_DAYS = 1;
export const COST_COVERAGE_MAX_DAYS = 366;
export const COST_COVERAGE_DEFAULT_DAYS = 30;

/** Raw repository figures of one coverage window (reporting currency). */
export interface CostCoverageRawFigures {
  /** Distinct non-stale variants with net sales in the window. */
  soldVariantCount: number;
  /** Of those, the ones that currently have no cost. */
  soldVariantsWithoutCost: number;
  /** Net sales (VAT-exclusive) of the whole population, i.e. margin's net revenue. */
  netSales: number;
  /** Net sales of lines whose variant currently has no cost. */
  netSalesWithoutCost: number;
  /** Net sales of lines that never resolved to a variant (cannot be given a per-variant cost). */
  productOnlyNetSales: number;
  /** Always all four reasons, from the margin gap classification. */
  gaps: MarginGapSum[];
}

/** One variant of the top-without-cost ranking. */
export interface CostCoverageTopVariantRow {
  variantId: string;
  productId: string;
  netSales: number;
}

export interface CostCoverageTopVariant extends CostCoverageTopVariantRow {
  /** Share of `netSalesWithoutCost`, 0..100; `null` when that is 0. */
  sharePct: number | null;
}

export interface CostCoverageResult {
  days: number;
  /** Inclusive window start, UTC. */
  from: Date;
  /** Exclusive window end, UTC (start of the day after the last counted day). */
  to: Date;
  currency: string;
  soldVariantCount: number;
  soldVariantsWithoutCost: number;
  netSales: number;
  netSalesWithoutCost: number;
  /** `(netSales - netSalesWithoutCost) / netSales * 100`; `null` when there are no net sales. */
  coveragePct: number | null;
  /** Sum of every margin gap bucket: net sales that margin leaves out for this window. */
  notInMarginNetSales: number;
  gapByReason: MarginGapSum[];
  top3: CostCoverageTopVariant[];
  /** The top 3 variants' net sales as a share of `netSalesWithoutCost`, 0..100; `null` when that is 0. */
  top3SharePct: number | null;
  productOnlyNetSales: number;
}

export interface CostWorklistFilters {
  tab: CostWorklistTab;
  /** Case-insensitive match on product name or SKU. */
  q?: string;
  /** `sourceConnectionId` of the sales; narrows the sales columns and requires a sale there. */
  channel?: string;
  limit: number;
  offset: number;
}

export type CostWorklistCountFilters = Omit<CostWorklistFilters, 'limit' | 'offset'>;

export interface CostWorklistRow {
  variantId: string;
  productId: string;
  productName: string;
  sku: string | null;
  attributes: Record<string, string> | null;
  /** Decimal string, as stored (`numeric(12,4)`); `null` = not recorded. */
  netUnitCost: string | null;
  costCurrency: string | null;
  costUpdatedAt: Date | null;
  /** Net sales in the last 30 days, reporting currency. */
  netSales30d: number;
  units30d: number;
  /** Source connections the variant sold through in the window. */
  soldOnConnectionIds: string[];
}

export interface CostWorklistResult {
  currency: string;
  items: CostWorklistRow[];
  /** Omitted when the caller opted out of the count (`withTotal=false`). */
  total?: number;
}

export interface CostSummary {
  variantsWithoutCost: number;
  productsWithoutCost: number;
  variantsWithCost: number;
}
