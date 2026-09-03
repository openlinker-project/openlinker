/**
 * Analytics Remediation types
 *
 * Mirrors `AnalyticsRemediationRunResponseDto` (#2468) — the run created by
 * `POST /analytics/coverage/currency/recalculate` — plus the paginated
 * `GET /analytics/coverage/currency/orders` drill-down consumed by the
 * `detail-currency` modal (#2474, Phase 7).
 *
 * @module features/analytics/api
 */
import type { CoverageResolutionStatus } from './analytics-coverage.types';

export interface AnalyticsRemediationRun {
  id: string;
  category: string;
  status: CoverageResolutionStatus;
  detail: string | null;
  affectedCount: number;
  triggeredByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecalculateCurrencyInput {
  /** ISO 8601, inclusive. */
  from: string;
  /** ISO 8601, exclusive. */
  to: string;
  sourceConnectionId?: string;
}

export interface CurrencyMismatchOrder {
  internalOrderId: string;
  sourceConnectionId: string;
  /** The order's own native currency; `null` for a row predating that column. */
  nativeCurrency: string | null;
  /** The reporting currency the order is stamped in; `null` when never stamped. */
  stampedCurrency: string | null;
  stampedAt: string | null;
  /**
   * Every distinct product this order's lines touch (#2799, corrected per
   * #2799 review BLOCKING 1) — the join key against `TopProductRow.productId`.
   * Empty only if this order genuinely carries no line items.
   */
  lineProducts: Array<{ productId: string; variantId: string | null }>;
}

export interface CurrencyMismatchOrdersPage {
  items: CurrencyMismatchOrder[];
  total: number;
}

export interface GetCurrencyMismatchOrdersInput extends RecalculateCurrencyInput {
  limit?: number;
  offset?: number;
}
