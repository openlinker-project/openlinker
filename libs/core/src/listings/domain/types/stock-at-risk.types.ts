/**
 * Stock At Risk Types
 *
 * Type definitions for the stock-at-risk "needs attention" aggregate (#1983):
 * variants that publish nothing to the connection - master stock minus the
 * stock safety buffer (#1844), then the zero threshold (#2610), comes out at
 * zero. Both knobs are ways to publish nothing, so both belong in the count.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface StockAtRiskItem {
  variantId: string;
  productId: string;
  connectionId: string;
  masterStock: number;
  stockSafetyBuffer: number;
  /**
   * The connection's zero threshold. `0` means the threshold is off and the
   * buffer alone accounts for the variant being at risk.
   */
  stockZeroThreshold: number;
}

/**
 * Bounded/paged result of the stock-at-risk read. `totalCount` is the number
 * of at-risk items found before the page-size cap was applied.
 */
export interface StockAtRiskResult {
  items: StockAtRiskItem[];
  totalCount: number;
}
