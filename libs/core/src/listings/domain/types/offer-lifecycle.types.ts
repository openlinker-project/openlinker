/**
 * Offer Lifecycle
 *
 * The four operator-facing buckets the redesigned `/listings` page partitions
 * its rows into (#2025 / epic #2023). Both the union and the pure derivation
 * live here so the rule is unit-testable in TypeScript rather than encoded in
 * SQL - mirroring the `pricing-rule.types.ts` / `stock-safety-buffer.types.ts`
 * pure-helper-in-domain-types precedent (#1843 / #1844).
 *
 * All four buckets derive from ONE source: the `offer_status_snapshots` row
 * joined on `(externalOfferId, connectionId)`. Because they partition a single
 * closed enum plus one boolean (does the snapshot carry validator messages),
 * the buckets are disjoint and their counts sum to the filtered total.
 *
 * ⚠ The Draft bucket must NOT be sourced from `OfferCreationRecord.status`.
 * The creation poller (#447) maps BOTH a clean `inactive` AND `ended` to
 * `OFFER_CREATION_STATUS.Draft`, so a creation-record-keyed Draft bucket would
 * swallow ended offers and break disjointness against Ended. The snapshot's
 * `publicationStatus` is the only field that separates the two.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link OfferPublicationStatus} for the neutral marketplace observation
 */
import type { OfferPublicationStatus } from './offer-status-read.types';
import type { OfferStatusSnapshotDetails } from './offer-status-snapshot.types';

export const OfferLifecycleValues = ['Active', 'Inactive', 'Draft', 'Ended'] as const;
export type OfferLifecycle = (typeof OfferLifecycleValues)[number];

/**
 * Resolve the lifecycle bucket of one mapped offer from its persisted status
 * snapshot. Pure - no I/O, no defaults invented from absence (a caller with no
 * snapshot row has nothing to classify and must not call this).
 *
 * `activating` / `inactivating` fold into `Active`: both describe an offer the
 * marketplace is mid-transition on, and an operator scanning the Active tab
 * should still see it (the row carries an `ACTIVATING` badge instead).
 */
export function deriveOfferLifecycle(
  publicationStatus: OfferPublicationStatus,
  statusDetails: OfferStatusSnapshotDetails | null
): OfferLifecycle {
  switch (publicationStatus) {
    case 'active':
    case 'activating':
    case 'inactivating':
      return 'Active';
    case 'ended':
      return 'Ended';
    case 'inactive':
      // The marketplace validator rejected it (Inactive) versus it simply
      // never went live (Draft) - the only signal separating the two.
      return readValidationMessages(statusDetails).length > 0 ? 'Inactive' : 'Draft';
  }
}

/**
 * Normalise the optional, intentionally-loose validator message list off a
 * snapshot's detail blob into an always-present array.
 */
export function readValidationMessages(
  statusDetails: OfferStatusSnapshotDetails | null
): readonly string[] {
  return statusDetails?.validationMessages ?? [];
}
