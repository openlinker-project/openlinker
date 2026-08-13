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
 * @module libs/core/src/listings/domain/types
 * @see {@link OfferStatusReader} for the capability
 */

import type { CreateOfferValidationError } from './offer-create.types';

export const OfferPublicationStatusValues = [
  'active',
  'activating',
  'inactivating',
  'inactive',
  'ended',
] as const;
export type OfferPublicationStatus = (typeof OfferPublicationStatusValues)[number];

export interface OfferStatusReadResult {
  publicationStatus: OfferPublicationStatus;
  validationErrors: CreateOfferValidationError[];
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
  /** `null` when the offer has never been read from the marketplace. */
  lastStatusSyncedAt: Date | null;
}
