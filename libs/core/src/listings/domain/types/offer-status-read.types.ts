/**
 * Offer Status Read Types
 *
 * Neutral observation contract for `OfferStatusReader.getOfferStatus`. Adapters
 * report the marketplace-side state of an existing offer; OL-internal record
 * lifecycle (the `OfferCreationStatus` union, `'failed'` etc.) is owned by the
 * application service and lives elsewhere.
 *
 * The publication-status union mirrors the lifecycle Allegro exposes — it is
 * the only marketplace shipped today with an async-validation cycle. When a
 * second marketplace gains a `getOfferStatus` implementation the union will
 * either grow or be re-cut to its intersection.
 *
 * Persistence note (#816): the *creation poller* (#447) still maps this enum
 * straight into `OfferCreationStatus` and never persists it. The *steady-state
 * status sync* (#816) does persist it — as `OfferPublicationStatus` on the
 * `offer_status_snapshots` table — so a union change is no longer purely
 * non-breaking: a removed/renamed member needs a data migration for that
 * table. Adding a member stays additive. See ADR-009.
 *
 * `commercial` (#2024) is an additive, optional field: Allegro's and Erli's
 * per-offer status read already fetches the full offer/product resource (the
 * same object `getOffer`/`OfferReader` maps price + quantity from), so the
 * adapter can populate `commercial` off that SAME response with no second
 * marketplace call. `null` when the adapter's response carries no price
 * (never fabricated as zero). Existing consumers (`OfferStatusPollService`,
 * #447) ignore the field and are unaffected.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link OfferStatusReader} for the capability
 */

import type { CreateOfferValidationError } from './offer-create.types';
import type { MarketplaceOfferPrice } from './marketplace-offer.types';

export const OfferPublicationStatusValues = [
  'active',
  'activating',
  'inactivating',
  'inactive',
  'ended',
] as const;
export type OfferPublicationStatus = (typeof OfferPublicationStatusValues)[number];

/**
 * Channel-side commercial observation carried alongside a status read (#2024).
 * Reuses `MarketplaceOfferPrice` (the same shape `OfferReader.getOffer`
 * returns) so a single price representation exists across both capabilities.
 */
export interface OfferCommercialObservation {
  price: MarketplaceOfferPrice;
  availableQuantity: number;
}

export interface OfferStatusReadResult {
  publicationStatus: OfferPublicationStatus;
  validationErrors: CreateOfferValidationError[];
  /**
   * Price + available quantity read off the same per-offer response, or
   * `null` when the adapter's response carried no price data. Optional so
   * every existing `OfferStatusReader` implementer keeps compiling unchanged;
   * a reader that never populates it behaves exactly as it did pre-#2024.
   */
  commercial?: OfferCommercialObservation | null;
}
