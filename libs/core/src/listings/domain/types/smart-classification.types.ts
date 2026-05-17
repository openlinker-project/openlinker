/**
 * Smart Classification Report Types
 *
 * Neutral, marketplace-agnostic classification report. Today only Allegro
 * produces one (via `GET /sale/offers/{offerId}/smart`); the shape is named
 * generically so future marketplaces with classification programs can reuse
 * it without a rename. Stored on `OfferCreationRecord.classificationReport`.
 *
 * Null when never read — pre-bulk-flow records, marketplaces without a
 * classification surface, or readback failures.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface SmartClassificationReport {
  /**
   * Whether the offer currently meets the marketplace's classification.
   * `null` when the marketplace can't yet determine (Allegro returns 404
   * for offers not yet classified post-create).
   */
  fulfilled: boolean | null;
  conditions: SmartClassificationCondition[];
  /**
   * Marketplace will re-evaluate within its policy window (Allegro: 24h).
   * When true, the FE may want to refresh on its next visit.
   */
  scheduledForReclassification?: boolean;
}

export interface SmartClassificationCondition {
  /** Technical condition name (`deliveryMethodPrices`, `returnPaidBy`, etc.). */
  code: string;
  /** Marketplace-localized condition name for display. */
  name: string;
  /** Marketplace-localized description suitable for showing an operator. */
  description: string;
  fulfilled: boolean;
}
