/**
 * Calendar Date in a Time Zone
 *
 * The `YYYY-MM-DD` an instant falls on in an IANA time zone. A document's legal
 * dates are calendar days in the issuer's zone, so slicing `toISOString()`
 * (the UTC day) puts an invoice issued between midnight and 01:00/02:00 in
 * Warsaw on the previous day (DEF-33). Pure and framework-free; `Intl` does the
 * zone arithmetic, including the daylight-saving switch.
 *
 * @module date
 */

/**
 * @param timeZone - an IANA zone id; absent means UTC. An invalid id makes
 *   `Intl.DateTimeFormat` throw - callers pass a validated zone.
 */
export function toCalendarDate(date: Date, timeZone?: string): string {
  if (!timeZone) {
    return date.toISOString().slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: 'year' | 'month' | 'day'): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
