/**
 * Stock At Risk Types
 *
 * Type definitions for the stock-at-risk "needs attention" aggregate (#1983):
 * variants a connection has listed that it cannot currently sell.
 *
 * The predicate is now `availableToPromise <= 0` (#2323), asked of
 * `IAvailabilityService` in the destination's `channel` scope rather than
 * recomputed here from master stock and a locally-read buffer. On a Wave-1b
 * install (empty reservation ledger) the two are provably the same number —
 * `max(0, totalAvailable − buffer)` — so no row changes. Once the ledger
 * carries `published` holds, the predicate WIDENS to include variants whose
 * remaining stock is fully spoken for, which is the intended Wave-2 behaviour.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface StockAtRiskItem {
  variantId: string;
  productId: string;
  connectionId: string;
  masterStock: number;
  /**
   * The cushion the destination's Controls hold back, for DISPLAY (#1844).
   * Read via `IAvailabilityService.getAppliedReserve`, never applied here —
   * `availableToPromise` is already net of it.
   */
  stockSafetyBuffer: number;
  /**
   * Units OpenLinker will promise on this connection right now (#2323) — the
   * number the at-risk predicate actually tests. Always `<= 0` on a returned
   * row; a variant whose availability is UNKNOWN is skipped entirely rather
   * than reported, because a row here asserts a number about the operator's
   * stock and OL must not assert one it does not have.
   */
  availableToPromise: number;
  /**
   * Units that exist in stock but are already spoken for:
   * `max(0, (masterStock − stockSafetyBuffer) − availableToPromise)`.
   *
   * **Always 0 on a Wave-1b install, and that is correct, not a stub.** The
   * reservation ledger is empty, so promised ≡ 0 and available-to-promise is
   * exactly `max(0, masterStock − buffer)`; there is nothing for the shortfall
   * to measure. It becomes non-zero the moment holds stamped `published`
   * exist — which is what distinguishes "this variant has no stock" from "this
   * variant's remaining stock is already sold", two states the pre-#2323
   * aggregate could not tell apart.
   */
  shortfall: number;
}

/**
 * Bounded/paged result of the stock-at-risk read. `totalCount` is the number
 * of at-risk items found before the page-size cap was applied.
 */
export interface StockAtRiskResult {
  items: StockAtRiskItem[];
  totalCount: number;
}
