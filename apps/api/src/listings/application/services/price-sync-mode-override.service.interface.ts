/**
 * Price Sync Mode Override Service Interface (#3162 re-review, IMPORTANT —
 * "interface and implementation in one file")
 *
 * `docs/engineering-standards.md § Interface and Implementation Separation`
 * is unconditional; the implementation previously carried the interface, the
 * Symbol token AND the class in one file.
 *
 * @module apps/api/src/listings/application/services
 * @see {@link PriceSyncModeOverrideService} for the implementation
 */
import type { PriceChangeConnectionPair } from '@openlinker/core/listings';

/** One pair's opt-in outcome (#3162 re-review, IMPORTANT — "the optInAutomatic result is discarded"). */
export interface PriceSyncModeOverrideOutcome extends PriceChangeConnectionPair {
  applied: boolean;
}

export interface IPriceSyncModeOverrideService {
  /**
   * Set `(destinationConnectionId).config.priceSyncMode.sourceOverrides[sourceConnectionId]`
   * to `'automatic'`. Best-effort: a failure is logged and reported via the
   * return value rather than thrown, since the price publish this
   * accompanies has already succeeded/been enqueued and a failure to flip
   * the mode must not be reported as a failed accept.
   */
  setSourceOverrideAutomatic(pair: PriceChangeConnectionPair): Promise<boolean>;

  /**
   * Convenience for a de-duplicated list of pairs (bulk accept). Returns
   * EVERY pair's own outcome (#3162 re-review, IMPORTANT) — previously this
   * discarded each `setSourceOverrideAutomatic` result, so an operator
   * ticking "always accept from this source" on a bulk submit could get a
   * 200 response while the connection was never actually flipped, with no
   * signal anywhere that it hadn't been.
   */
  setSourceOverridesAutomatic(
    pairs: readonly PriceChangeConnectionPair[]
  ): Promise<readonly PriceSyncModeOverrideOutcome[]>;
}

export const PRICE_SYNC_MODE_OVERRIDE_SERVICE_TOKEN = Symbol('IPriceSyncModeOverrideService');
