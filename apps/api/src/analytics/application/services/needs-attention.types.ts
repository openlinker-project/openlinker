/**
 * Needs Attention Types
 *
 * Type definitions for the composed "needs attention" summary (#1983) —
 * kept out of `needs-attention.service.interface.ts` per the "types belong
 * in a separate *.types.ts file" convention (docs/engineering-standards.md
 * § Type Definitions in Separate Files).
 *
 * @module apps/api/src/analytics/application/services
 */
import type { CoverageGapItem, StockAtRiskItem } from '@openlinker/core/listings';
import type { FailedSyncValueSummary } from '@openlinker/core/orders';

export interface NeedsAttentionSummary {
  coverageGaps: CoverageGapItem[];
  // Total gap count before the page-size cap was applied — lets the caller
  // tell "there are more" from "this is everything" (the reason
  // `CoverageGapsResult.totalCount` exists in the first place; dropping it
  // here would silently defeat that).
  coverageGapsTotalCount: number;
  stockAtRisk: StockAtRiskItem[];
  stockAtRiskTotalCount: number;
  failedSyncValue: FailedSyncValueSummary;
}
