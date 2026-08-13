/**
 * Stock At Risk Types
 *
 * Type definitions for the stock-at-risk "needs attention" aggregate (#1983):
 * variants whose master stock, minus the connection's stock safety buffer
 * (#1844), is at or below zero.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface StockAtRiskItem {
  variantId: string;
  productId: string;
  connectionId: string;
  masterStock: number;
  stockSafetyBuffer: number;
}

/**
 * Bounded/paged result of the stock-at-risk read. `totalCount` is the number
 * of at-risk items found before the page-size cap was applied.
 */
export interface StockAtRiskResult {
  items: StockAtRiskItem[];
  totalCount: number;
}
