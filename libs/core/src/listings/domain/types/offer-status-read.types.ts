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
 * either grow or be re-cut to its intersection; either change is non-breaking
 * because OL never persists this enum (the service maps it into
 * `OfferCreationStatus` immediately).
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
