/**
 * Date Range Helpers
 *
 * Pure preset/derive math for the /analytics date-range toolbar. The
 * preset-derivation and draft/commit semantics are new for this page — see
 * Decision 1 in docs/plans/implementation-plan-analytics-page-shell.md.
 *
 * **Clock + inclusivity contract (#2098 tech review).** `computePresetRange`
 * / `derivePreset` operate on the OPERATOR'S LOCAL calendar day
 * (`getFullYear`/`getMonth`/`getDate`), both endpoints INCLUSIVE — that is
 * the mental model "last 7 days" matches for someone reading the toolbar,
 * and it is what the mockup's URL contract (`from`/`to` as bare
 * `YYYY-MM-DD`, no time/zone) assumes. The backend's `/analytics/sales`
 * range (#1987) is UTC-bucketed and `to`-EXCLUSIVE
 * (`SalesAnalyticsQueryDto.to: "Range end, exclusive"`, `placedAt < :to`
 * in SQL) — a deliberate choice made independently, for a different reason
 * (so its daily trend buckets align on UTC midnight regardless of the
 * requesting operator's zone). The two clocks are NOT reconciled by
 * pretending the toolbar means UTC days too — an operator's "today" is
 * their own local day, not UTC's, and silently swapping the toolbar to UTC
 * days would just move the confusion from the API boundary to the toolbar
 * itself. `toUtcRangeInstants` below is the single conversion point: every
 * future `/analytics/*` consumer of this toolbar's `from`/`to` MUST route
 * through it rather than passing the raw strings to an API client,
 * otherwise "7d" silently becomes six days with today's orders missing
 * (the inclusive/exclusive mismatch) displaced by up to a day for a
 * non-UTC operator (the local/UTC mismatch) — both accepted as a known,
 * bounded displacement, never as an unbounded one.
 *
 * @module apps/web/src/features/analytics/lib
 */

export type DateRangePreset = '7d' | '30d' | '90d';
export type DateRangeHighlight = DateRangePreset | 'custom';

export const PRESET_DAYS: Record<DateRangePreset, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function computePresetRange(
  preset: DateRangePreset,
  today: Date
): { from: string; to: string } {
  const to = new Date(today);
  const from = new Date(today);
  from.setDate(from.getDate() - (PRESET_DAYS[preset] - 1));
  return { from: formatDate(from), to: formatDate(to) };
}

export function derivePreset(from: string, to: string, today: Date): DateRangeHighlight {
  const presets: DateRangePreset[] = ['7d', '30d', '90d'];
  const match = presets.find((preset) => {
    const range = computePresetRange(preset, today);
    return range.from === from && range.to === to;
  });
  return match ?? 'custom';
}

/**
 * Converts a local-day, inclusive `{from, to}` (this module's URL/toolbar
 * contract) into the UTC instants a `/analytics/*` backend range expects —
 * `to` EXCLUSIVE, per `SalesAnalyticsQueryDto.to` (#1987). `from` maps to
 * UTC midnight of the same calendar date; `to` maps to UTC midnight of the
 * day AFTER, so a query using `placedAt < :to` includes every order placed
 * on the `to` day. See the module header for why this stays local-day-in,
 * UTC-instant-out rather than making the toolbar itself UTC.
 */
export function toUtcRangeInstants(from: string, to: string): { from: string; to: string } {
  const fromInstant = `${from}T00:00:00.000Z`;
  const toExclusive = new Date(`${to}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
  return { from: fromInstant, to: toExclusive.toISOString() };
}

/** Parses a bare `YYYY-MM-DD` as a LOCAL calendar day, matching `computePresetRange`'s clock — never `new Date(dateStr)`, which parses as UTC midnight and would silently shift by a day for a non-UTC operator. */
function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The immediately-preceding period of the same length — "the N days before
 * `from`", never "the same period a year ago". `from`/`to` are both
 * inclusive local calendar days (this module's contract), and the result
 * keeps that contract: a 7-day range gets a 7-day previous range ending the
 * day before `from` starts. Works identically for a preset-derived range or
 * an arbitrary custom one — the caller never needs to know which.
 */
export function computePreviousPeriodRange(from: string, to: string): { from: string; to: string } {
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);
  const windowDays =
    Math.round((toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  const previousTo = new Date(fromDate);
  previousTo.setDate(previousTo.getDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setDate(previousFrom.getDate() - (windowDays - 1));

  return { from: formatDate(previousFrom), to: formatDate(previousTo) };
}

/**
 * Whether a previous-period range starting on `previousFrom` is FULLY
 * covered by ingested order history, given the earliest order date across
 * the connection(s) in scope (`IOrderRecordService.getEarliestOrderDateByConnection`,
 * surfaced on `GET /analytics/trust`, #2083). A PARTIAL previous window
 * (`earliestOrderDate` falls inside it) is refused outright rather than
 * compared against a full current-period window — a shorter window's totals
 * are naturally smaller, and reporting that as a real period-over-period
 * drop would misrepresent a data-coverage gap as a demand signal.
 * `earliestOrderDate: null` (nothing ever ingested) is never covered.
 * Compares calendar days as plain strings — up to a day of imprecision from
 * `earliestOrderDate`'s time-of-day component is accepted, the same posture
 * this module already takes on the local/UTC toolbar displacement above.
 */
export function isPreviousPeriodCovered(previousFrom: string, earliestOrderDate: string | null): boolean {
  if (earliestOrderDate === null) {
    return false;
  }
  return previousFrom >= earliestOrderDate.slice(0, 10);
}
