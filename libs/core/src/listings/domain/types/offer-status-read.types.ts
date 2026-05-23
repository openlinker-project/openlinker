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
 * table. Adding a member stays additive. See ADR-008.
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
