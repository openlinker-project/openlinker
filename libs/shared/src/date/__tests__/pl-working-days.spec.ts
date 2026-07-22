/**
 * Unit tests for Polish working-day arithmetic.
 *
 * Anchored at Europe/Warsaw civil dates. Cases cover: weekend skip, fixed-date
 * holiday skip, computus-derived holiday skip (Corpus Christi), and a DST
 * boundary (spring-forward) case.
 *
 * @module date
 */
import {
  addWorkingDays,
  easterSunday,
  isPlPublicHoliday,
  isPlWorkingDay,
} from '../pl-working-days';

/** Warsaw civil `YYYY-MM-DD` for an instant (asserts calendar day, not time). */
function warsawDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

describe('easterSunday', () => {
  it('should match known Gregorian Easter dates', () => {
    // Reference values (month, day).
    expect(easterSunday(2024)).toEqual([3, 31]);
    expect(easterSunday(2025)).toEqual([4, 20]);
    expect(easterSunday(2026)).toEqual([4, 5]);
  });
});

describe('isPlPublicHoliday', () => {
  it('should flag a fixed-date holiday (Constitution Day, May 3)', () => {
    expect(isPlPublicHoliday(new Date('2026-05-03T09:00:00.000Z'))).toBe(true);
  });

  it('should flag Easter Monday (E+1, computus-derived)', () => {
    // Easter 2026 = Apr 5 → Easter Monday = Apr 6.
    expect(isPlPublicHoliday(new Date('2026-04-06T09:00:00.000Z'))).toBe(true);
  });

  it('should flag Corpus Christi (E+60, computus-derived)', () => {
    // Easter 2026 = Apr 5 → Corpus Christi = Jun 4.
    expect(isPlPublicHoliday(new Date('2026-06-04T09:00:00.000Z'))).toBe(true);
  });

  it('should not flag a plain working day', () => {
    expect(isPlPublicHoliday(new Date('2026-06-16T09:00:00.000Z'))).toBe(false);
  });
});

describe('isPlWorkingDay', () => {
  it('should treat weekends as non-working', () => {
    // 2026-06-20 is a Saturday, 2026-06-21 a Sunday.
    expect(isPlWorkingDay(new Date('2026-06-20T09:00:00.000Z'))).toBe(false);
    expect(isPlWorkingDay(new Date('2026-06-21T09:00:00.000Z'))).toBe(false);
  });

  it('should treat a public holiday as non-working', () => {
    expect(isPlWorkingDay(new Date('2026-06-04T09:00:00.000Z'))).toBe(false);
  });

  it('should treat a plain weekday as working', () => {
    expect(isPlWorkingDay(new Date('2026-06-16T09:00:00.000Z'))).toBe(true);
  });
});

describe('addWorkingDays', () => {
  it('should add plain working days within a week', () => {
    // Tue 2026-06-16 + 2 working days → Thu 2026-06-18.
    const result = addWorkingDays(new Date('2026-06-16T09:59:00.000Z'), 2);
    expect(warsawDate(result)).toBe('2026-06-18');
  });

  it('should skip the weekend', () => {
    // Fri 2026-06-19 + 2 working days → skip Sat/Sun → Tue 2026-06-23.
    const result = addWorkingDays(new Date('2026-06-19T09:59:00.000Z'), 2);
    expect(warsawDate(result)).toBe('2026-06-23');
  });

  it('should skip a fixed-date public holiday', () => {
    // Thu 2026-04-30 + 2 working days: Fri May 1 (Labour Day, holiday) skipped,
    // Sat/Sun skipped → Mon May 4, then Tue May 5. So +2 lands on Tue May 5.
    const result = addWorkingDays(new Date('2026-04-30T09:00:00.000Z'), 2);
    expect(warsawDate(result)).toBe('2026-05-05');
  });

  it('should skip a computus-derived holiday (Corpus Christi)', () => {
    // Corpus Christi 2026 = Thu Jun 4. Wed 2026-06-03 + 1 working day:
    // Thu Jun 4 (Corpus Christi) skipped → Fri Jun 5.
    const result = addWorkingDays(new Date('2026-06-03T09:00:00.000Z'), 1);
    expect(warsawDate(result)).toBe('2026-06-05');
  });

  it('should classify the calendar day at Warsaw offset, not UTC', () => {
    // 2026-06-19T23:30Z is Fri in UTC but already Sat 01:30 in Warsaw (CEST,
    // +02:00). +1 working day from Saturday → Monday Jun 22 (Warsaw).
    const result = addWorkingDays(new Date('2026-06-19T23:30:00.000Z'), 1);
    expect(warsawDate(result)).toBe('2026-06-22');
  });

  it('should preserve the Warsaw wall-clock time-of-day across a DST spring-forward', () => {
    // DST 2026 spring-forward: 2026-03-29 02:00 → 03:00 CEST. Start Fri Mar 27
    // 12:00 Warsaw (11:00Z, CET +01:00). +1 working day → Mon Mar 30, which is
    // in CEST (+02:00), so 12:00 Warsaw == 10:00Z. Wall time stays 12:00.
    const result = addWorkingDays(new Date('2026-03-27T11:00:00.000Z'), 1);
    expect(warsawDate(result)).toBe('2026-03-30');
    const warsawTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(result);
    expect(warsawTime).toBe('12:00');
  });

  it('should return an unchanged copy for a non-positive count', () => {
    const from = new Date('2026-06-16T09:59:00.000Z');
    expect(addWorkingDays(from, 0).getTime()).toBe(from.getTime());
    expect(addWorkingDays(from, -3).getTime()).toBe(from.getTime());
  });
});
