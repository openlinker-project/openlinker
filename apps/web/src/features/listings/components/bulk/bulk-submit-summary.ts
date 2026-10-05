/**
 * Bulk submit outcome summary (#1933, #3492)
 *
 * Turns the backend's bulk-create response into the success-toast sentence.
 * The backend drops variants for three independent reasons - already listed
 * (#1933), unresolvable availability (#2323) and an unacknowledged GS1
 * checksum failure (#3492) - and reports each as its own count. Every one of
 * them shrinks the batch, so the queued figure subtracts all three and each
 * non-zero reason is named; an exclusion the toast does not mention is a
 * shrink the operator cannot see.
 *
 * Kept React-free so every combination can be pinned by a plain unit test.
 *
 * @module apps/web/src/features/listings/components/bulk
 */
import type { BulkOfferCreateResponse } from '../../api/bulk-listings.types';

export type BulkSubmitSkipCounts = Pick<
  BulkOfferCreateResponse,
  'skippedAlreadyListedCount' | 'skippedInvalidEanCount' | 'skippedAvailabilityUnknownCount'
>;

/**
 * Success-toast description for a marketplace bulk submit. `selectedCount` is
 * the number of variants the wizard sent; the queued count never goes below
 * zero even if the backend reports more skips than were sent.
 */
export function describeBulkSubmitOutcome(
  selectedCount: number,
  skips: BulkSubmitSkipCounts
): string {
  const reasons: string[] = [];
  if (skips.skippedAlreadyListedCount > 0) {
    reasons.push(`${skips.skippedAlreadyListedCount.toLocaleString()} already listed`);
  }
  if (skips.skippedInvalidEanCount > 0) {
    reasons.push(`${skips.skippedInvalidEanCount.toLocaleString()} with an invalid EAN checksum`);
  }
  if (skips.skippedAvailabilityUnknownCount > 0) {
    // Transient on the backend (#2323), so the operator is told a re-submit may help.
    reasons.push(
      `${skips.skippedAvailabilityUnknownCount.toLocaleString()} with unknown availability (re-submit to retry)`
    );
  }
  const skipped =
    skips.skippedAlreadyListedCount +
    skips.skippedInvalidEanCount +
    skips.skippedAvailabilityUnknownCount;
  const queuedCount = Math.max(0, selectedCount - skipped);
  const queued = `${queuedCount.toLocaleString()} offers queued for creation.`;
  return reasons.length > 0 ? `${queued} Skipped: ${reasons.join(', ')}.` : queued;
}
