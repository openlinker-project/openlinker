/**
 * Needs Attention Types
 *
 * Frontend transport types mirroring the backend `NeedsAttentionResponseDto`
 * contract (`GET /analytics/needs-attention`, #1983). Hand-written per the
 * FE-001 contract strategy — keep in sync with the backend DTO.
 *
 * @module apps/web/src/features/analytics/api
 */

export interface CoverageGapItem {
  variantId: string;
  productId: string;
  listedOnConnectionIds: string[];
  missingFromConnectionIds: string[];
}

export interface StockAtRiskItem {
  variantId: string;
  productId: string;
  connectionId: string;
  masterStock: number;
  stockSafetyBuffer: number;
}

/**
 * `mixedCurrency: true` means `totalValue` sums orders across more than one
 * currency and must not be labeled with a single currency symbol. There is
 * no currency field on this contract for the non-mixed case either — the
 * consumer renders a currency-neutral number in both cases (#1989 pre-implement
 * gate finding; a real per-order currency awaits #2049's reporting-currency
 * stamping on `order_records`).
 */
export interface FailedSyncValueSummary {
  count: number;
  totalValue: number;
  mixedCurrency: boolean;
  oldestFailedAt: string | null;
}

export interface NeedsAttentionSummary {
  coverageGaps: CoverageGapItem[];
  coverageGapsTotalCount: number;
  stockAtRisk: StockAtRiskItem[];
  stockAtRiskTotalCount: number;
  failedSyncValue: FailedSyncValueSummary;
}
