/**
 * Offer Lifecycle
 *
 * The five operator-facing buckets the redesigned `/listings` page partitions
 * its rows into (#2025 / epic #2023). Both the union and the pure derivation
 * live here so the rule is unit-testable in TypeScript rather than encoded in
 * SQL - mirroring the `pricing-rule.types.ts` / `stock-safety-buffer.types.ts`
 * pure-helper-in-domain-types precedent (#1843 / #1844).
 *
 * Four of the five derive from ONE source: the `offer_status_snapshots` row
 * joined on `(externalOfferId, connectionId)`. Because they partition a single
 * closed enum plus one boolean (does the snapshot carry validator messages),
 * those four are disjoint. `Unsynced` covers the complement - a mapping the
 * hourly status scan has not reached yet - so all five together do partition
 * the filtered total and their counts sum to it.
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

/**
 * `Unsynced` is a deliberate deviation from the #1965 mockup's four tabs, not
 * drift: the status scan is hourly at 100 offers/tick, so most of a large
 * catalog carries no snapshot for days. Without a fifth bucket those rows
 * belong to no tab at all and an operator reads a four-figure catalog as
 * having lost most of its listings.
 */
export const OfferLifecycleValues = ['Active', 'Inactive', 'Draft', 'Ended', 'Unsynced'] as const;
export type OfferLifecycle = (typeof OfferLifecycleValues)[number];

/**
 * Resolve the lifecycle bucket of one mapped offer from its persisted status
 * snapshot. Pure - no I/O, no defaults invented from absence.
 *
 * Its domain is a snapshot that EXISTS; it never returns `Unsynced`. A caller
 * whose join found no snapshot row classifies that absence itself (the read
 * model emits `Unsynced`), keeping this function a total map over the closed
 * `OfferPublicationStatus` union.
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
