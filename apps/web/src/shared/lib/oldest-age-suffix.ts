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
 * The words come from `format.oldestAge` in the active language (or `locale`,
 * like the shared formatters); the separator stays here.
 *
 * @module apps/web/src/shared/lib
 */
import { getLocale } from '../i18n/active-locale';
import { interpolate } from '../i18n/interpolate';
import { messagesIn } from '../i18n/messages';
import type { SupportedLocale } from '../i18n/i18n.types';

export function oldestAgeSuffix(
  oldestAt: string | null | undefined,
  locale?: SupportedLocale,
): string {
  if (!oldestAt) return '';
  const heldSince = new Date(oldestAt).getTime();
  if (!Number.isFinite(heldSince)) return '';
  const copy = messagesIn('format', locale ?? getLocale()).oldestAge;
  const days = Math.floor((Date.now() - heldSince) / 86_400_000);
  if (days >= 1) return ` · ${interpolate(copy.days, { n: days })}`;
  const hours = Math.floor((Date.now() - heldSince) / 3_600_000);
  return hours >= 1 ? ` · ${interpolate(copy.hours, { n: hours })}` : '';
}
