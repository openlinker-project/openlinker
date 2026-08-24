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
import type { OfferValidationProblem } from './offer-validation-problem.types';

export const OfferPublicationStatusValues = [
  'active',
  'activating',
  'inactivating',
  'inactive',
  'ended',
] as const;
export type OfferPublicationStatus = (typeof OfferPublicationStatusValues)[number];

/**
 * Narrow an arbitrary string onto the closed union.
 *
 * Needed because `offer_status_snapshots."publicationStatus"` is a plain `text`
 * column with NO check constraint (see the persistence note above): TypeScript
 * proves a `switch` over `OfferPublicationStatus` total, but it cannot prove the
 * COLUMN only ever holds those five values. Any read path that classifies a
 * persisted status must narrow through this guard rather than trusting the
 * declared row type, or an out-of-union value silently falls off the end of an
 * exhaustive switch as `undefined`.
 */
export function isOfferPublicationStatus(value: string): value is OfferPublicationStatus {
  return (OfferPublicationStatusValues as readonly string[]).includes(value);
}

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
   * Price + available quantity read off the same per-offer response. An adapter
   * populates this whenever the read succeeded, including when one or both
   * fields came back `null` - reporting absence is the adapter's job, deciding
   * what to persist is not (see `UpsertOfferCommercialSnapshotCommand` for the
   * rule the sync service applies). Optional so every existing
   * `OfferStatusReader` implementer keeps compiling unchanged; a reader that
   * never populates it behaves exactly as it did pre-#2024.
   */
  commercial?: OfferCommercialObservation;
}

/**
 * One row of the operator-facing per-product status read (#2039).
 *
 * Covers every offer OL knows is mapped to the product — **including offers
 * with no snapshot yet**, which report `publicationStatus: null`. Previously
 * this read returned snapshot rows only, so a product whose offers had never
 * been synced rendered as an empty panel: the operator could not tell "no
 * offers here" from "offers exist, status not read yet", and the per-offer
 * manual refresh (the only mitigation for the latter) was unreachable because
 * it is rendered per returned row.
 */
export interface OfferPublicationStatusView {
  connectionId: string;
  externalOfferId: string;
  internalVariantId: string;
  /** `null` when the offer has never been read from the marketplace. */
  publicationStatus: OfferPublicationStatus | null;
  /** Marketplace validation messages captured with the status. */
  validationMessages: string[];
  /**
   * The same refusals in structured form (#2231) - the panel renders the
   * sentence for the seller and the platform's own `code` for whoever has to
   * check it against the platform's docs or quote it in a support ticket. Empty
   * on a snapshot written before #2231.
   */
  validationProblems: OfferValidationProblem[];
  /** `null` when the offer has never been read from the marketplace. */
  lastStatusSyncedAt: Date | null;
}
