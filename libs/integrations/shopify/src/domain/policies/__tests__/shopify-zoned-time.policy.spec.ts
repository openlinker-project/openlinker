import {
  isKnownTimeZone,
  isRealCalendarDay,
  zonedDayEdgeToInstant,
} from '../shopify-zoned-time.policy';

describe('shopify zoned time policy', () => {
  it('should start a Warsaw winter day an hour before UTC midnight', () => {
    expect(zonedDayEdgeToInstant('2026-01-15', 'start', 'Europe/Warsaw')).toBe('2026-01-14T23:00:00.000Z');
  });

  it('should start a Warsaw summer day two hours before UTC midnight', () => {
    expect(zonedDayEdgeToInstant('2026-07-15', 'start', 'Europe/Warsaw')).toBe('2026-07-14T22:00:00.000Z');
  });

  it('should end a New York day after UTC midnight', () => {
    expect(zonedDayEdgeToInstant('2026-01-15', 'end', 'America/New_York')).toBe('2026-01-16T04:59:59.999Z');
  });

  it('should use the offset in force at the edge on a DST change day', () => {
    // Warsaw springs forward on 2026-03-29: that day starts at +01:00 and ends at +02:00.
    expect(zonedDayEdgeToInstant('2026-03-29', 'start', 'Europe/Warsaw')).toBe('2026-03-28T23:00:00.000Z');
    expect(zonedDayEdgeToInstant('2026-03-29', 'end', 'Europe/Warsaw')).toBe('2026-03-29T21:59:59.999Z');
  });

  it('should leave UTC unchanged', () => {
    expect(zonedDayEdgeToInstant('2026-11-01', 'start', 'UTC')).toBe('2026-11-01T00:00:00.000Z');
  });

  it('should return null for an unknown zone or an unreal day', () => {
    expect(zonedDayEdgeToInstant('2026-11-01', 'start', 'Mars/Olympus')).toBeNull();
    expect(zonedDayEdgeToInstant('2026-13-45', 'start', 'UTC')).toBeNull();
  });

  it('should tell real calendar days from impossible ones', () => {
    expect(isRealCalendarDay('2026-02-28')).toBe(true);
    expect(isRealCalendarDay('2028-02-29')).toBe(true);
    expect(isRealCalendarDay('2026-02-29')).toBe(false);
    expect(isRealCalendarDay('2026-13-45')).toBe(false);
    expect(isRealCalendarDay('2026-2-3')).toBe(false);
  });

  it('should know IANA names', () => {
    expect(isKnownTimeZone('Europe/Warsaw')).toBe(true);
    expect(isKnownTimeZone('nope')).toBe(false);
  });
});
