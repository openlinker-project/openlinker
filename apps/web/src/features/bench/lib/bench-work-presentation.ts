/**
 * Bench work-list presentation rules (#2416, `W3b-3`, stories B2/B4)
 *
 * How a row is grouped, how its deadline is phrased, and how the search field
 * matches — as pure functions, so each can be checked against the story it
 * comes from without rendering anything.
 *
 * ## The deadline ARITHMETIC is reused, only the wording is new
 *
 * `shared/format/format-ship-by.ts` already computes exactly this from
 * `dispatchByAt`: pure, `now`-injected, and shipped for #927. It stays the one
 * home for the calculation. What differs here is the words: that helper reads
 * `3h left` beside a table on a desk, and this surface needs a headline legible
 * at arm's length from a bench. Two vocabularies for one number would be drift;
 * one number with a second register is a deliberate choice, recorded here.
 *
 * @module apps/web/src/features/bench/lib
 */
import { formatShipBy, type ShipByLevel } from '../../../shared/format/format-ship-by';
import type { BenchWork } from '../api/bench-work.types';
import { benchWorkCopy } from './bench-work.copy';

/**
 * Which section a row belongs in.
 *
 * Story B4: state is carried by POSITION as well as by text and colour, and
 * this is the position half. A held or cancelled parcel sits under its own
 * heading rather than being tinted in place, so a packer scanning the screen
 * sees the boundary before reading a word.
 */
export type BenchSection = 'to-pack' | 'do-not-pack';

/**
 * Rows that must not be packed, keyed on `state`.
 *
 * An UNRECOGNISED state sorts to `do-not-pack`, which is the safe direction: a
 * value this build does not know about is one it cannot vouch for, and the cost
 * of wrongly asking a packer to check with someone is a question, while the cost
 * of wrongly telling them to pack is a parcel that should not have gone.
 */
export function sectionOf(work: BenchWork): BenchSection {
  return work.state === 'packable' ? 'to-pack' : 'do-not-pack';
}

/** Split the list into its two sections, preserving the server's order within each. */
export function groupBenchWork(works: readonly BenchWork[]): {
  toPack: BenchWork[];
  doNotPack: BenchWork[];
} {
  const toPack: BenchWork[] = [];
  const doNotPack: BenchWork[] = [];
  for (const work of works) {
    if (sectionOf(work) === 'to-pack') toPack.push(work);
    else doNotPack.push(work);
  }
  return { toPack, doNotPack };
}

/** A deadline as the bench states it: a headline, and the precise remainder. */
export interface BenchDeadlineView {
  /** Legible across a room. Never implies the goods are ready. */
  readonly headline: string;
  /** `formatShipBy`'s own phrase, e.g. `3h left`. `null` when there is no deadline. */
  readonly remaining: string | null;
  /** For the caller's tone choice. `null` when there is no deadline to have one. */
  readonly level: ShipByLevel | null;
}

/**
 * Phrase a dispatch deadline for a bench.
 *
 * An absent or unparseable deadline is stated as such rather than hidden: a
 * packer needs to know the difference between "this must go today" and "nobody
 * told us when this goes", and rendering nothing conflates them.
 */
export function describeBenchDeadline(
  dispatchByAt: string | null,
  now: Date = new Date()
): BenchDeadlineView {
  const shipBy = formatShipBy(dispatchByAt, now);
  if (shipBy === null) {
    return { headline: benchWorkCopy.row.deadlineUnknown, remaining: null, level: null };
  }

  const headline =
    shipBy.level === 'overdue'
      ? benchWorkCopy.row.deadlineOverdue
      : shipBy.level === 'soon'
        ? benchWorkCopy.row.deadlineSoon
        : benchWorkCopy.row.deadlineLater;

  return { headline, remaining: shipBy.remaining, level: shipBy.level };
}

/**
 * Normalise a reference so the search is as forgiving as the placeholder claims.
 *
 * Case is folded and every non-alphanumeric character dropped, so `OL-4471`,
 * `ol 4471` and `allegro-4471` all reduce to a form containing `4471`. That is
 * what makes typing the bare number find the parcel — the behaviour the
 * placeholder teaches, and therefore a behaviour the field owes.
 */
export function normaliseReference(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * The digits of a reference, in order.
 *
 * The placeholder teaches that a marketplace prefix still finds the parcel —
 * typing `allegro-4471` must find `OL-4471`. Those two share no substring once
 * normalised, because the PREFIXES differ and only the number is common. So the
 * number is compared on its own as well.
 *
 * Digits rather than "the last word": references are punctuated inconsistently
 * across marketplaces, and the run of digits is the part a human is actually
 * reading off a screen or a picking note.
 */
export function readReferenceDigits(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * Does this row match what was typed?
 *
 * Three ways, in the order they are cheapest to reason about:
 *
 * 1. **The normalised reference contains the normalised query** — `4471`,
 *    `OL-4471` and `ol 4471` all find `OL-4471`.
 * 2. **The digit runs match** — which is what lets a DIFFERENT prefix find it,
 *    the case the placeholder advertises and the one a substring test cannot
 *    reach. Guarded on a minimum length so a stray `4` does not match the whole
 *    bench: a single digit is not a reference, it is a typo in progress.
 * 3. **The buyer's name as an ordinary case-insensitive substring** — a surname
 *    is prose, and normalising it the same way would run words together.
 *
 * An empty or blank query matches everything, so clearing the field restores
 * the list rather than emptying it.
 */
export function matchesBenchSearch(work: BenchWork, query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0) return true;

  const normalised = normaliseReference(trimmed);
  const reference = normaliseReference(work.orderReference);
  if (normalised.length > 0 && reference.includes(normalised)) return true;

  const queryDigits = readReferenceDigits(trimmed);
  const referenceDigits = readReferenceDigits(work.orderReference);
  if (
    queryDigits.length >= MIN_DIGIT_MATCH_LENGTH &&
    referenceDigits.length > 0 &&
    referenceDigits.includes(queryDigits)
  ) {
    return true;
  }

  const name = work.buyerName;
  return name !== null && name.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * The shortest digit run that may match on its own.
 *
 * Two, so a single mistyped digit does not select the whole bench while the
 * packer is still typing. Every reference this surface will meet is longer.
 */
const MIN_DIGIT_MATCH_LENGTH = 2;

/**
 * Which expedite verb, if any, this row offers right now.
 *
 * Read from the server's `supportedActions` and never derived from
 * `expeditedAt`. The server decides what is legal — a cancelled parcel carries
 * no actions at all, and a client inferring the direction from the flag would
 * offer a control on a row that would refuse it.
 */
export function expediteActionFor(work: BenchWork): 'expedite' | 'release_expedite' | null {
  if (work.supportedActions.includes('release_expedite')) return 'release_expedite';
  if (work.supportedActions.includes('expedite')) return 'expedite';
  return null;
}
