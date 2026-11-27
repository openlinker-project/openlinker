/**
 * Shopify Zoned Time Policy
 *
 * Turns a bare calendar day into the instant it starts or ends IN THE SHOP'S OWN
 * time zone. An operator who picks "1 November" means the shop's November 1st,
 * and a shop in Warsaw begins that day an hour before UTC does; reading the day
 * as UTC would silently drop or add the orders of those hours.
 *
 * Pure and dependency-free (Intl only). A zone the runtime does not know is
 * reported as `null` so the caller decides on a fallback and says so.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */

const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ZonedDayEdge = 'start' | 'end';

/** True for `YYYY-MM-DD` that names a real calendar day (not 2026-02-30, not 2026-13-45). */
export function isRealCalendarDay(value: string): boolean {
  const match = BARE_DAY.exec(value);
  if (match === null) {
    return false;
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/** Whether the runtime can resolve this IANA zone name. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The zone's offset from UTC, in ms, at the given instant. */
function offsetAt(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(utcMs));
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const wallAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  // The formatter has whole-second resolution; compare against the floored instant.
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The UTC instant at which `day` starts (00:00:00.000) or ends (23:59:59.999) on
 * the clock of `timeZone`. Returns null for a day that is not real or a zone the
 * runtime does not know. A wall time skipped by a DST jump resolves to the
 * instant just after the jump, which is the day's true first moment.
 */
export function zonedDayEdgeToInstant(day: string, edge: ZonedDayEdge, timeZone: string): string | null {
  const match = BARE_DAY.exec(day);
  if (match === null || !isRealCalendarDay(day) || !isKnownTimeZone(timeZone)) {
    return null;
  }
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const wall =
    edge === 'start'
      ? Date.UTC(year, month - 1, date, 0, 0, 0, 0)
      : Date.UTC(year, month - 1, date, 23, 59, 59, 999);
  // The offset depends on the instant being solved for, so settle it in two steps
  // to stay correct across a DST transition inside the day.
  const first = wall - offsetAt(wall, timeZone);
  const settled = wall - offsetAt(first, timeZone);
  return new Date(settled).toISOString();
}
