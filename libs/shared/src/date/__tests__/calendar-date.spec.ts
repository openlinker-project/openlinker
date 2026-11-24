/**
 * toCalendarDate — Unit Specs (DEF-33)
 *
 * @module date
 */
import { toCalendarDate } from '../calendar-date';

describe('toCalendarDate', () => {
  it('should return the UTC day when no zone is given', () => {
    expect(toCalendarDate(new Date('2026-03-21T23:30:00.000Z'))).toBe('2026-03-21');
  });

  it('should move 23:30Z to the next day in Warsaw in winter (CET, UTC+1)', () => {
    expect(toCalendarDate(new Date('2026-01-21T23:30:00.000Z'), 'Europe/Warsaw')).toBe('2026-01-22');
  });

  it('should move 22:30Z to the next day in Warsaw in summer (CEST, UTC+2)', () => {
    expect(toCalendarDate(new Date('2026-07-21T22:30:00.000Z'), 'Europe/Warsaw')).toBe('2026-07-22');
  });

  it('should keep the same day when the instant is well inside it', () => {
    expect(toCalendarDate(new Date('2026-07-21T10:00:00.000Z'), 'Europe/Warsaw')).toBe('2026-07-21');
  });
});
