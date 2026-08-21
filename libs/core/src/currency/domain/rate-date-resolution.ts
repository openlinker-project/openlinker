/**
 * Rate Date Resolution
 *
 * Pure derivation of WHICH calendar day an order should be stamped against.
 * No I/O, no dependency on any other context, no date library (the repo has
 * none - `Intl` is the house tool).
 *
 * DELIBERATELY CALENDAR-NEUTRAL. This function yields a CANDIDATE calendar
 * day and knows about neither weekends nor any country's holidays; each
 * provider adapter absorbs its own publication calendar from that candidate
 * (NBP applies the Polish working-day calendar plus a 404 walk-back, ECB
 * passes it as `endPeriod` with `lastNObservations=1`).
 *
 * A shared Polish calendar here would be wrong: ECB publishes on Polish-only
 * holidays, so an order placed the day after one would be stamped with a rate
 * one or more days stale - silently, with no error anywhere. Verified against
 * the live API: for an order placed Friday 2026-06-05, a Polish calendar skips
 * Thursday 2026-06-04 (Corpus Christi) and resolves 4.2383 where ECB's actual
 * last publication before Friday is 4.2368.
 *
 * @module libs/core/src/currency/domain
 */
import type { FxRateRule } from './types/fx-rate-rule.types';

const WARSAW_TIME_ZONE = 'Europe/Warsaw';

/**
 * `en-CA` renders a date as `YYYY-MM-DD`, which is both the ISO form we
 * persist and lexicographically comparable - so the clamp below is a string
 * comparison rather than another round of instant arithmetic.
 */
const warsawDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: WARSAW_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Europe/Warsaw civil calendar day of an instant, as ISO `YYYY-MM-DD`. */
function warsawCalendarDay(instant: Date): string {
  return warsawDayFormatter.format(instant);
}

/** Shift an ISO `YYYY-MM-DD` by whole days, with no timezone involved. */
function shiftIsoDay(isoDay: string, days: number): string {
  const [year, month, day] = isoDay.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const y = String(shifted.getUTCFullYear()).padStart(4, '0');
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * The candidate rate day for an order, or `null` when there is none.
 *
 * `null` is the TERMINAL signal - no stamp, no retry enqueue - and is returned
 * rather than thrown for a missing or unparseable `placedAt`. That matters
 * concretely: WooCommerce orders can arrive with `placedAt` `undefined`, and
 * without this guard every foreign-currency WooCommerce order would throw
 * (or raise a `RangeError` out of `Intl`) and die after ten retries.
 *
 * The result is CLAMPED to today in Warsaw. That clamp is load-bearing, not
 * defensive: a future `endPeriod` makes ECB answer with a months-stale rate at
 * HTTP 200 and no signal of any kind, so a clock skew or a bad source
 * timestamp would otherwise be stamped as fact.
 *
 * @param placedAt when the order was placed, or `null`/`undefined`
 * @param rule which rule to apply
 * @param now injected only so specs can pin the clamp; defaults to the wall clock
 * @returns ISO `YYYY-MM-DD`, or `null` when no rate date can be derived
 */
export function resolveRateDate(
  placedAt: Date | null | undefined,
  rule: FxRateRule,
  now: Date = new Date()
): string | null {
  if (placedAt === undefined || placedAt === null || Number.isNaN(placedAt.getTime())) {
    return null;
  }

  const today = warsawCalendarDay(now);
  const candidate = resolveCandidate(placedAt, rule);

  return candidate < today ? candidate : today;
}

function resolveCandidate(placedAt: Date, rule: FxRateRule): string {
  switch (rule) {
    case 'prev-business-day':
      // The previous CALENDAR day. "business" names the intent of the rule
      // (do not stamp against a day whose rate may not be published yet);
      // resolving it onto a day the source actually published on belongs to
      // the adapter, which is the only layer that knows the source's calendar.
      return shiftIsoDay(warsawCalendarDay(placedAt), -1);
  }
}
