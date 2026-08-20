/**
 * Unit tests for Polish working-day arithmetic.
 *
 * Anchored at Europe/Warsaw civil dates. Cases cover: weekend skip, fixed-date
 * holiday skip, computus-derived holiday skip (Corpus Christi), a DST boundary
 * (spring-forward) case, and the same classes of skip walked backwards.
 *
 * @module date
 */
import {
  addWorkingDays,
  easterSunday,
  isPlPublicHoliday,
  isPlWorkingDay,
  previousWorkingDay,
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

  it('should flag Wigilia (Dec 24, statutory non-working day since 2025)', () => {
    expect(isPlPublicHoliday(new Date('2026-12-24T09:00:00.000Z'))).toBe(true);
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

  it('should skip Wigilia chained with the following public holidays and weekend', () => {
    // 2026-12-24 (Wigilia, Thu) and 12-25 (Boże Narodzenie, Fri) are holidays;
    // 12-26/27 (Sat/Sun) are the weekend. Wed Dec 23 + 1 working day lands on
    // the next actual working day, Mon Dec 28 — skipping all four in between.
    const result = addWorkingDays(new Date('2026-12-23T09:00:00.000Z'), 1);
    expect(warsawDate(result)).toBe('2026-12-28');
  });

  it('should classify the calendar day at Warsaw offset, not UTC', () => {
    // 2026-06-21T23:30Z is Sun in UTC but already Mon 01:30 in Warsaw (CEST,
    // +02:00). +1 working day from Monday → Tue Jun 23 (Warsaw). The instant is
    // chosen so the two anchorings DIVERGE: a UTC-anchored walk would start on
    // Sunday and answer Mon Jun 22, so this case fails if the Warsaw anchoring
    // is ever dropped.
    const result = addWorkingDays(new Date('2026-06-21T23:30:00.000Z'), 1);
    expect(warsawDate(result)).toBe('2026-06-23');
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

describe('previousWorkingDay', () => {
  it('should return the previous calendar day when the input is mid-week', () => {
    // Wed 2026-06-17 → Tue 2026-06-16 (both plain working days).
    const result = previousWorkingDay(new Date('2026-06-17T09:00:00.000Z'));
    expect(warsawDate(result)).toBe('2026-06-16');
  });

  it('should return the previous Friday when the input is a Monday', () => {
    // Mon 2026-06-22 → skip Sun/Sat → Fri 2026-06-19.
    const result = previousWorkingDay(new Date('2026-06-22T09:00:00.000Z'));
    expect(warsawDate(result)).toBe('2026-06-19');
  });

  it('should return Friday when the input is a Saturday', () => {
    // Sat 2026-06-20 → Fri 2026-06-19.
    const result = previousWorkingDay(new Date('2026-06-20T09:00:00.000Z'));
    expect(warsawDate(result)).toBe('2026-06-19');
  });

  it('should return Friday when the input is a Sunday', () => {
    // Sun 2026-06-21 → skip Sat → Fri 2026-06-19.
    const result = previousWorkingDay(new Date('2026-06-21T09:00:00.000Z'));
    expect(warsawDate(result)).toBe('2026-06-19');
  });

  it('should walk back past a computus-derived holiday (Corpus Christi)', () => {
    // Corpus Christi 2026 = Thu Jun 4. Fri Jun 5 → Thu Jun 4 skipped → Wed Jun 3.
    const result = previousWorkingDay(new Date('2026-06-05T09:00:00.000Z'));
    expect(warsawDate(result)).toBe('2026-06-03');
  });

  it('should walk back over several days when a holiday is adjacent to a weekend', () => {
    // Mon 2026-05-04 → Sun May 3 (Constitution Day + weekend), Sat May 2, and
    // Fri May 1 (Labour Day) are all non-working → Thu 2026-04-30.
    const result = previousWorkingDay(new Date('2026-05-04T09:00:00.000Z'));
    expect(warsawDate(result)).toBe('2026-04-30');
  });

  it('should classify the calendar day at Warsaw offset, not UTC', () => {
    // 2026-06-19T22:30Z is Fri in UTC but already Sat 00:30 in Warsaw (CEST,
    // +02:00). Walking back from Saturday → Fri Jun 19 (Warsaw). The instant is
    // chosen so the two anchorings DIVERGE: a UTC-anchored walk would start on
    // Friday and answer Thu Jun 18, so this case fails if the Warsaw anchoring
    // is ever dropped.
    const result = previousWorkingDay(new Date('2026-06-19T22:30:00.000Z'));
    expect(warsawDate(result)).toBe('2026-06-19');
  });

  it('should recompute movable holidays when the walk crosses a year boundary', () => {
    // Fri 2026-01-02 walks back past Nowy Rok (Thu Jan 1) into the previous
    // year, so the holiday set is rebuilt for 2025 mid-walk.
    const result = previousWorkingDay(new Date('2026-01-02T09:00:00.000Z'));
    expect(warsawDate(result)).toBe('2025-12-31');
  });

  it('should skip the Wigilia and Christmas chain together with the weekend', () => {
    // Mon 2025-12-29 walks back over Sun 12-28, Sat 12-27, and the three
    // consecutive holidays 12-26, 12-25 and 12-24 (Wigilia) — the longest real
    // run of non-working days in the Polish calendar — landing on Tue Dec 23.
    const result = previousWorkingDay(new Date('2025-12-29T09:00:00.000Z'));
    expect(warsawDate(result)).toBe('2025-12-23');
  });

  it('should preserve the Warsaw wall-clock time-of-day across a DST boundary', () => {
    // DST 2026 spring-forward: 2026-03-29 02:00 → 03:00 CEST. Start Mon Mar 30
    // 12:00 Warsaw (10:00Z, CEST +02:00). Walking back → Fri Mar 27, which is in
    // CET (+01:00), so 12:00 Warsaw == 11:00Z. Wall time stays 12:00.
    const result = previousWorkingDay(new Date('2026-03-30T10:00:00.000Z'));
    expect(warsawDate(result)).toBe('2026-03-27');
    const warsawTime = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Warsaw',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(result);
    expect(warsawTime).toBe('12:00');
  });
});
