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
 * marketplace call. Absent only when the adapter does not implement the read
 * at all; a fetched-but-sparse response yields an observation whose individual
 * fields are `null` (never fabricated as zero). Existing consumers
 * (`OfferStatusPollService`, #447) ignore the field and are unaffected.
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
 *
 * The two axes are independently nullable on purpose: a marketplace response
 * that omits price still carries a trustworthy quantity (and vice versa), and
 * welding them together would discard the half that did arrive. `null` always
 * means "not reported"; it is never a stand-in for zero.
 */
export interface OfferCommercialObservation {
  /** `null` when the response carried no price. Never fabricated as zero. */
  price: MarketplaceOfferPrice | null;
  /** `null` when the response carried no quantity. Never defaulted to zero. */
  availableQuantity: number | null;
}

export interface OfferStatusReadResult {
  publicationStatus: OfferPublicationStatus;
  validationErrors: CreateOfferValidationError[];
  /**
   * Price + available quantity read off the same per-offer response. Present
   * whenever the read succeeded, even if both fields came back `null` - the
   * successful read is itself the freshness signal. Optional so every existing
   * `OfferStatusReader` implementer keeps compiling unchanged; a reader that
   * never populates it behaves exactly as it did pre-#2024.
   */
  commercial?: OfferCommercialObservation;
}
