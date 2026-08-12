/**
 * Needs Attention Service Interface
 *
 * Defines the contract for composing the three "needs attention" aggregates
 * (#1983) into one response.
 *
 * @module apps/api/src/analytics/application/services
 */
import type { CoverageGapItem, StockAtRiskItem } from '@openlinker/core/listings';
import type { FailedSyncValueSummary } from '@openlinker/core/orders';

export interface NeedsAttentionSummary {
  coverageGaps: CoverageGapItem[];
  stockAtRisk: StockAtRiskItem[];
  failedSyncValue: FailedSyncValueSummary;
}

export interface INeedsAttentionService {
  getSummary(): Promise<NeedsAttentionSummary>;
}
