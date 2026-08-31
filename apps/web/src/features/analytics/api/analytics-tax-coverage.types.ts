/**
 * Analytics Tax Coverage types
 *
 * Mirrors `TaxCoverageOrderDto` / `TaxCoverageOrdersResponseDto`
 * (`GET /analytics/coverage/tax/orders`) and `TaxRerunBackfillRequestDto` /
 * `TaxRerunBackfillResponseDto` (`POST /analytics/coverage/tax/rerun-backfill`,
 * #2469) — the tax A/B/C category's paginated drill-downs plus the one
 * genuinely-write category-C action, added for the Data Coverage panel
 * (#2474, Phase 7).
 *
 * @module features/analytics/api
 */
import type { CoverageCategory } from './analytics-coverage.types';

/** Tax A/B/C only — never `'currency'` / `'product-matching'`. */
export type TaxCoverageCategory = Extract<CoverageCategory, 'tax-a' | 'tax-b' | 'tax-c'>;

export interface TaxCoverageOrder {
  internalOrderId: string;
  sourceConnectionId: string;
  /** `null` for a historical row with no resolvable placement date. */
  placedAt: string | null;
}

export interface TaxCoverageOrdersPage {
  items: TaxCoverageOrder[];
  total: number;
}

export interface GetTaxCoverageOrdersInput {
  category: TaxCoverageCategory;
  /** ISO 8601, inclusive. */
  from: string;
  /** ISO 8601, exclusive. */
  to: string;
  sourceConnectionId?: string;
  limit?: number;
  offset?: number;
}

export interface RerunTaxBackfillInput {
  internalOrderIds: string[];
}

export interface RerunTaxBackfillResult {
  /** Rate-less lines examined across every requested order. */
  scanned: number;
  /** Of those, lines the current catalogue resolved a rate for and wrote. */
  updated: number;
}
