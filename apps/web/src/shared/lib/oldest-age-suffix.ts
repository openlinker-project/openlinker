/**
 * Oldest-age suffix (#3194 review)
 *
 * A single shared implementation of the " · oldest N d" / " · oldest N h"
 * elapsed-time phrase, previously duplicated verbatim between
 * `orders-list-page.tsx`'s `blockedAgeSuffix` (the `salesDocumentBlocked`
 * chip) and `invoices-list-page.tsx`'s `pendingSubmissionAgeSuffix` (the
 * "Awaiting submission" chip) - same thresholds, same string, same '' fallback.
 * Two copies of one operator-facing string is exactly the drift the repo's
 * mirror-guard scripts exist to catch elsewhere; extracting costs nothing.
 *
 * `oldestAt` is the OLDEST instant among the rows the caller is describing -
 * an ELAPSED measurement, never an ETA. Returns an empty string when nothing
 * is held or the instant is unreadable - an absent age says less than a
 * wrong one.
 *
 * @module apps/web/src/shared/lib
 */
export function oldestAgeSuffix(oldestAt: string | null | undefined): string {
  if (!oldestAt) return '';
  const heldSince = new Date(oldestAt).getTime();
  if (!Number.isFinite(heldSince)) return '';
  const days = Math.floor((Date.now() - heldSince) / 86_400_000);
  if (days >= 1) return ` · oldest ${String(days)} d`;
  const hours = Math.floor((Date.now() - heldSince) / 3_600_000);
  return hours >= 1 ? ` · oldest ${String(hours)} h` : '';
}
