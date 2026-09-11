/**
 * Price Change Auto-Applied Log Types (#3144)
 *
 * @module libs/core/src/listings/domain/types
 */

export interface RecordAutoAppliedPriceChangeInput {
  productVariantId: string;
  destinationConnectionId: string;
  sourceConnectionId: string;
  /**
   * `null` for a first-ever detection with no recorded baseline (#3159's
   * `PriceChangeEpisode.computedOldAmount === null`) — REQUIRED (not
   * optional) so a caller can never omit it and have it silently default to
   * `newAmount` (#3161 review: every prior write recorded `oldAmount ===
   * newAmount`, which read as "no price actually changed").
   */
  oldAmount: number | null;
  newAmount: number;
  currency: string;
  appliedAt: Date;
}
