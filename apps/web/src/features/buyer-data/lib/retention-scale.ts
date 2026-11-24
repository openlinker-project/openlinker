/**
 * Retention Scale (#4289)
 *
 * The pure arithmetic behind the age strip: the detent stops a handle snaps to,
 * the mapping between an age and a horizontal position, the zone an age falls
 * in for a pair of cut-offs, and the rule that keeps "erase" from landing
 * before "hide". Nothing here touches the DOM, so the strip, the record card
 * and the tests all read one definition.
 *
 * Ages are whole days; `0` means "never" (that cut is off), as everywhere else
 * in this feature.
 *
 * @module apps/web/src/features/buyer-data/lib
 */
import { BUYER_DATA_MAX_DAYS, BUYER_DATA_MIN_DAYS } from './buyer-data-config';

/** The stops a handle snaps to: the periods an operator actually reasons in. */
export const RETENTION_DETENTS: readonly number[] = [
  30, 60, 90, 180, 365, 540, 730, 1095, 1825, 3650,
];

/** Detents worth a tick mark on the axis. */
export const RECOMMENDED_DETENTS: readonly number[] = [90, 365, 730, 1825];

export const DAYS_PER_MONTH = 30;
export const AXIS_MONTHS = 120;
/** Share of the strip's width given to the "no end" slot after the last month. */
export const NEVER_SLOT_PCT = 10;
export const AXIS_PCT = 100 - NEVER_SLOT_PCT;
/** `aria-valuenow` of a handle parked on "never": one past the largest period. */
export const NEVER_VALUE = BUYER_DATA_MAX_DAYS + 1;

export type RetentionZone = 'kept' | 'hidden' | 'erased';

export function clampDays(days: number): number {
  return Math.min(BUYER_DATA_MAX_DAYS, Math.max(BUYER_DATA_MIN_DAYS, Math.round(days)));
}

/** The detent closest to `days` (ties go to the longer period: the safer way to be wrong). */
export function snapToDetent(days: number): number {
  let best = RETENTION_DETENTS[0] ?? BUYER_DATA_MIN_DAYS;
  for (const detent of RETENTION_DETENTS) {
    if (Math.abs(detent - days) <= Math.abs(best - days)) best = detent;
  }
  return best;
}

/** 0 (never) is the last stop: the stops are [30 .. 3650, never]. */
export function nextDetent(days: number, steps = 1): number {
  let current = days;
  for (let i = 0; i < steps; i += 1) {
    if (current === 0) return 0;
    const next = RETENTION_DETENTS.find((d) => d > current);
    current = next ?? 0;
  }
  return current;
}

export function prevDetent(days: number, steps = 1): number {
  let current = days;
  for (let i = 0; i < steps; i += 1) {
    if (current === 0) {
      current = RETENTION_DETENTS[RETENTION_DETENTS.length - 1] ?? BUYER_DATA_MAX_DAYS;
      continue;
    }
    const lower = [...RETENTION_DETENTS].reverse().find((d) => d < current);
    current = lower ?? BUYER_DATA_MIN_DAYS;
  }
  return current;
}

/** Horizontal position (0..100) of a cut; "never" parks in the middle of the no-end slot. */
export function daysToPct(days: number): number {
  if (days <= 0) return AXIS_PCT + NEVER_SLOT_PCT / 2;
  return (Math.min(days, BUYER_DATA_MAX_DAYS) / BUYER_DATA_MAX_DAYS) * AXIS_PCT;
}

/**
 * The cut a pointer at `pct` means. Past the end of the axis it is "never";
 * otherwise it snaps to a detent, or to a single day with `fine` (Shift).
 */
export function pctToDays(pct: number, fine = false): number {
  if (pct >= AXIS_PCT + NEVER_SLOT_PCT / 4) return 0;
  const raw = (Math.max(0, pct) / AXIS_PCT) * BUYER_DATA_MAX_DAYS;
  return fine ? clampDays(raw) : snapToDetent(clampDays(raw));
}

export function monthToAgeDays(ageMonths: number): number {
  return ageMonths * DAYS_PER_MONTH;
}

export interface RetentionCuts {
  hideAfterDays: number;
  eraseAfterDays: number;
}

/** What an order of this age ends up as under the cuts. */
export function zoneForAge(ageDays: number, cuts: RetentionCuts): RetentionZone {
  if (cuts.eraseAfterDays > 0 && ageDays >= cuts.eraseAfterDays) return 'erased';
  if (cuts.hideAfterDays > 0 && ageDays >= cuts.hideAfterDays) return 'hidden';
  return 'kept';
}

export interface CutChange extends RetentionCuts {
  /** True when moving one cut pushed the other along. */
  moved: boolean;
}

/**
 * Hide moved to `hide`. An erase cut that would now sit before it is pushed out
 * to meet it (erase may equal hide, never precede it).
 */
export function moveHide(cuts: RetentionCuts, hide: number): CutChange {
  const pushed = hide > 0 && cuts.eraseAfterDays > 0 && cuts.eraseAfterDays < hide;
  return {
    hideAfterDays: hide,
    eraseAfterDays: pushed ? hide : cuts.eraseAfterDays,
    moved: pushed,
  };
}

/** Erase moved to `erase`; it cannot go before a hide cut that is set. */
export function moveErase(cuts: RetentionCuts, erase: number): CutChange {
  const clamped = erase > 0 && cuts.hideAfterDays > 0 ? Math.max(erase, cuts.hideAfterDays) : erase;
  return { ...cuts, eraseAfterDays: clamped, moved: clamped !== erase };
}

export interface ZoneCounts {
  kept: number;
  hidden: number;
  erased: number;
}

/** Orders per zone, estimated from the histogram when the server has not answered yet. */
export function estimateZoneCounts(
  buckets: readonly { ageMonths: number; visible: number; hidden: number; erased: number }[],
  cuts: RetentionCuts
): ZoneCounts {
  const counts: ZoneCounts = { kept: 0, hidden: 0, erased: 0 };
  for (const bucket of buckets) {
    const n = bucket.visible + bucket.hidden + bucket.erased;
    counts[zoneForAge(monthToAgeDays(bucket.ageMonths), cuts)] += n;
  }
  return counts;
}

/**
 * The age the example order opens on: the nearest month that still has orders
 * past the erase cut (so the example shows the whole effect), else past the hide
 * cut, else the oldest order, else today. It is the middle of that month.
 */
export function suggestExampleAge(
  buckets: readonly { ageMonths: number; visible: number }[],
  cuts: RetentionCuts
): number {
  const middle = (months: number): number =>
    Math.min(BUYER_DATA_MAX_DAYS, months * DAYS_PER_MONTH + 15);
  const live = buckets
    .filter((bucket) => bucket.visible > 0)
    .sort((a, b) => a.ageMonths - b.ageMonths);
  const beyond = (cut: number): number | undefined =>
    cut > 0 ? live.find((bucket) => middle(bucket.ageMonths) >= cut)?.ageMonths : undefined;
  const month =
    beyond(cuts.eraseAfterDays) ?? beyond(cuts.hideAfterDays) ?? live[live.length - 1]?.ageMonths;
  return month === undefined ? 0 : middle(month);
}
