/**
 * Polish working-day arithmetic.
 *
 * Pure, dependency-free helpers for advancing a date by a number of WORKING
 * days under Polish rules: Saturdays, Sundays, and Polish public holidays
 * (ustawa o dniach wolnych od pracy) are non-working. No date library exists in
 * the repo, so the computus + timezone math is hand-rolled here.
 *
 * All day-boundary classification is anchored at the **Europe/Warsaw** civil
 * calendar (via `Intl.DateTimeFormat`), NOT UTC — an instant late on a Friday
 * UTC that is already Saturday in Warsaw is correctly treated as a weekend, and
 * the resulting deadline preserves the source instant's Warsaw wall-clock
 * time-of-day across DST transitions.
 *
 * @module date
 */

const PL_TIME_ZONE = 'Europe/Warsaw';

/** Fixed-date Polish public holidays as `[month (1-12), day]` pairs. */
const PL_FIXED_HOLIDAYS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], // Nowy Rok
  [1, 6], // Święto Trzech Króli
  [5, 1], // Święto Pracy
  [5, 3], // Święto Konstytucji 3 Maja
  [8, 15], // Wniebowzięcie NMP
  [11, 1], // Wszystkich Świętych
  [11, 11], // Święto Niepodległości
  [12, 25], // Boże Narodzenie (1. dzień)
  [12, 26], // Boże Narodzenie (2. dzień)
];

/** Warsaw civil date-time parts derived from a UTC instant. */
interface CivilParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Europe/Warsaw UTC offset (ms) at a given instant. Computed by formatting the
 * instant into Warsaw wall-clock parts and diffing against the instant — robust
 * across CET/CEST DST transitions with no hard-coded rules.
 */
function warsawOffsetMs(instant: number): number {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: PL_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(instant));
  const read = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asIfUtc - instant;
}

/** Convert a UTC instant to its Europe/Warsaw civil calendar parts. */
function toWarsawCivil(date: Date): CivilParts {
  const shifted = new Date(date.getTime() + warsawOffsetMs(date.getTime()));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/**
 * Convert Europe/Warsaw civil wall-clock parts back to a UTC instant. Two-pass
 * to settle the offset when the target date sits on the other side of a DST
 * transition from the initial guess.
 */
function warsawCivilToInstant(c: CivilParts): Date {
  const asIfUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  const firstOffset = warsawOffsetMs(asIfUtc);
  let instant = asIfUtc - firstOffset;
  const settledOffset = warsawOffsetMs(instant);
  if (settledOffset !== firstOffset) {
    instant = asIfUtc - settledOffset;
  }
  return new Date(instant);
}

/**
 * Easter Sunday for a Gregorian year via the Anonymous Gregorian algorithm
 * (Meeus/Gauss / "computus"). Returns `[month (1-12), day]`.
 */
export function easterSunday(year: number): readonly [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthDayNumber = h + l - 7 * m + 114;
  const month = Math.floor(monthDayNumber / 31); // 3 = March, 4 = April
  const day = (monthDayNumber % 31) + 1;
  return [month, day];
}

/** Shift a `(month, day)` in a given year by `offsetDays`, normalising overflow. */
function shiftMonthDay(
  year: number,
  month: number,
  day: number,
  offsetDays: number,
): readonly [number, number] {
  const shifted = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return [shifted.getUTCMonth() + 1, shifted.getUTCDate()];
}

/**
 * The movable Polish public holidays derived from Easter Sunday `E`:
 *  - Easter Monday (`E + 1`)
 *  - Corpus Christi (`E + 60`)
 * `E` (Easter Sunday) and Pentecost (`E + 49`) always fall on a Sunday, so they
 * are already non-working via the weekend rule and are intentionally NOT listed
 * here. Good Friday is NOT a Polish public holiday and is intentionally omitted.
 */
function movablePlHolidays(year: number): ReadonlyArray<readonly [number, number]> {
  const [em, ed] = easterSunday(year);
  return [shiftMonthDay(year, em, ed, 1), shiftMonthDay(year, em, ed, 60)];
}

/** Pure `(year, month, day)` public-holiday check — no timezone conversion. */
function isPlPublicHolidayYmd(year: number, month: number, day: number): boolean {
  for (const [m, d] of PL_FIXED_HOLIDAYS) {
    if (m === month && d === day) {
      return true;
    }
  }
  for (const [m, d] of movablePlHolidays(year)) {
    if (m === month && d === day) {
      return true;
    }
  }
  return false;
}

/**
 * True when the given instant falls on a Polish public holiday, evaluated at the
 * Europe/Warsaw civil calendar date.
 */
export function isPlPublicHoliday(date: Date): boolean {
  const civil = toWarsawCivil(date);
  return isPlPublicHolidayYmd(civil.year, civil.month, civil.day);
}

/**
 * True when the given instant falls on a non-working day (Saturday, Sunday, or a
 * Polish public holiday), evaluated at the Europe/Warsaw civil calendar date.
 */
export function isPlWorkingDay(date: Date): boolean {
  const civil = toWarsawCivil(date);
  const proxy = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  const dow = proxy.getUTCDay();
  if (dow === 0 || dow === 6) {
    return false;
  }
  return !isPlPublicHolidayYmd(civil.year, civil.month, civil.day);
}

/**
 * Advance `from` by `days` Polish working days and return a new `Date`,
 * preserving the source instant's Europe/Warsaw wall-clock time-of-day. Weekends
 * and Polish public holidays are skipped. A non-positive / non-finite `days`
 * returns a copy of `from` unchanged; the source instant itself is never counted
 * (counting starts from the next day).
 */
export function addWorkingDays(from: Date, days: number): Date {
  let remaining = Number.isFinite(days) ? Math.max(0, Math.trunc(days)) : 0;
  const civil = toWarsawCivil(from);
  // Iterate on a date-only UTC proxy whose UTC parts mirror the Warsaw civil
  // date; weekday + holiday classification reads directly off those parts.
  const cursor = new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) {
      continue;
    }
    if (isPlPublicHolidayYmd(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate())) {
      continue;
    }
    remaining -= 1;
  }
  return warsawCivilToInstant({
    year: cursor.getUTCFullYear(),
    month: cursor.getUTCMonth() + 1,
    day: cursor.getUTCDate(),
    hour: civil.hour,
    minute: civil.minute,
    second: civil.second,
  });
}
