/**
 * Price Baseline Types
 *
 * What the master sync reads about a page of variants BEFORE upserting them, so
 * it can tell the price-change observer what actually changed (#3143, ADR-072)
 * and why (ADR-077).
 *
 * @module libs/core/src/products/application/types
 */

export interface PriceBaseline {
  /** Stored price per variant id; `null` = the variant had no recorded price. */
  readonly prices: ReadonlyMap<string, number | null>;
  /**
   * Variants still inside the ADR-077 tax-basis correction window: their stored
   * price may be the NET figure an older master adapter reported, so a change
   * observed now is the correction to gross rather than an ordinary price move.
   */
  readonly basisPending: ReadonlySet<string>;
}
