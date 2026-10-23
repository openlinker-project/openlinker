/**
 * Notes from the office - presentation (D12, scenario G03-6)
 *
 * The two derivations the read-only notes block makes from the wire: which
 * note comes first, and how a note's time reads at a bench. Kept pure and
 * apart from the component so both can be tested against a fixed clock.
 *
 * @module apps/web/src/features/bench/lib
 */
import { formatAbsoluteTime, formatDateTime } from '../../../shared/format/format-date';
import type { BenchPackerNote } from '../api/bench-parcel.types';
import { benchParcelCopy } from './bench-parcel.copy';

export interface BenchNoteTime {
  /** What the meta line shows: `today 12:40`, `yesterday 11:31`, or a full date. */
  readonly label: string;
  /** The absolute timestamp, always - for `title` on the `<time>`. */
  readonly full: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Whole LOCAL calendar days between two instants, `later` minus `earlier`.
 *
 * Built from each instant's own local y/m/d rather than a raw millisecond
 * difference: a note written at 23:50 is "yesterday" at 00:10, ten minutes
 * later, and a DST switch makes one calendar day 23 or 25 hours long - which
 * `Math.round` absorbs where `Math.floor` would not.
 */
function calendarDaysBetween(earlier: Date, later: Date): number {
  const start = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const end = new Date(later.getFullYear(), later.getMonth(), later.getDate());
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

/**
 * `today 12:40` / `yesterday 11:31` / the absolute date beyond that.
 *
 * A time in the future (the office's clock ahead of this bench's) falls to the
 * absolute form rather than to "today", because "today" would be a claim the
 * bench cannot check. An unparseable value is shown as received - the field is
 * the API's ISO string, and printing "Invalid Date" at a packer says less.
 */
export function describeBenchNoteTime(iso: string, now: Date = new Date()): BenchNoteTime {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return { label: iso, full: iso };

  const full = formatDateTime(iso);
  const days = calendarDaysBetween(at, now);
  if (days === 0 && at.getTime() <= now.getTime()) {
    return { label: benchParcelCopy.officeNotes.today(formatAbsoluteTime(iso)), full };
  }
  if (days === 1) {
    return { label: benchParcelCopy.officeNotes.yesterday(formatAbsoluteTime(iso)), full };
  }
  return { label: full, full };
}

/**
 * Newest first, as the mockup orders them.
 *
 * The API returns creation order (oldest first). At a bench the latest word
 * from the office is the one most likely to change what goes in the box, so
 * it leads. Copies rather than sorts in place - the array is query-cache data.
 * Ties keep the API's order, which `Array.prototype.sort` guarantees (stable);
 * an unparseable time sorts as the oldest rather than poisoning the comparator
 * with `NaN`, which would leave the whole order undefined.
 */
export function orderBenchOfficeNotes(
  notes: readonly BenchPackerNote[]
): readonly BenchPackerNote[] {
  const timeOf = (note: BenchPackerNote): number => {
    const at = new Date(note.createdAt).getTime();
    return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
  };
  return [...notes].sort((a, b) => {
    const difference = timeOf(b) - timeOf(a);
    // -Infinity minus -Infinity is NaN: two unparseable times are a tie.
    return Number.isNaN(difference) ? 0 : difference;
  });
}
