/**
 * Rate Date Resolution Tests
 *
 * @module libs/core/src/currency/domain/__tests__
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveRateDate } from '../rate-date-resolution';

describe('resolveRateDate', () => {
  const rule = 'prev-business-day';

  // A fixed "now" far enough in the future that no case below trips the clamp
  // unless it means to.
  const NOW = new Date('2027-01-01T12:00:00Z');

  describe('prev-business-day', () => {
    it('should return the previous calendar day when placedAt is mid-week', () => {
      // Wednesday 2026-06-10 -> Tuesday 2026-06-09.
      expect(resolveRateDate(new Date('2026-06-10T09:00:00Z'), rule, NOW)).toBe('2026-06-09');
    });

    it('should return Sunday when placedAt is a Monday', () => {
      // The candidate is a CALENDAR day: resolving Sunday onto a day the source
      // published on is the adapter's job, not this function's.
      expect(resolveRateDate(new Date('2026-06-08T09:00:00Z'), rule, NOW)).toBe('2026-06-07');
    });

    it('should return Friday when placedAt is a Saturday', () => {
      expect(resolveRateDate(new Date('2026-06-13T09:00:00Z'), rule, NOW)).toBe('2026-06-12');
    });

    it('should not skip a Polish public holiday', () => {
      // Friday 2026-06-05, the day after Corpus Christi. A Polish calendar
      // would answer 2026-06-03 here, which is the silently-stale ECB rate the
      // calendar-neutral rule exists to avoid.
      expect(resolveRateDate(new Date('2026-06-05T09:00:00Z'), rule, NOW)).toBe('2026-06-04');
    });

    it('should cross a month boundary', () => {
      expect(resolveRateDate(new Date('2026-07-01T09:00:00Z'), rule, NOW)).toBe('2026-06-30');
    });

    it('should cross a year boundary', () => {
      expect(resolveRateDate(new Date('2026-01-01T09:00:00Z'), rule, NOW)).toBe('2025-12-31');
    });
  });

  describe('Europe/Warsaw anchoring', () => {
    it('should use the Warsaw calendar day, not UTC, for a late-Sunday-UTC instant', () => {
      // 23:30 UTC on Sunday 2026-06-07 is already 01:30 Monday in Warsaw
      // (CEST, UTC+2), so the previous calendar day is Sunday, not Saturday.
      expect(resolveRateDate(new Date('2026-06-07T23:30:00Z'), rule, NOW)).toBe('2026-06-07');
    });

    it('should resolve a Europe/Warsaw DST-transition day', () => {
      // 2026-03-29 is the spring-forward day in Warsaw.
      expect(resolveRateDate(new Date('2026-03-29T10:00:00Z'), rule, NOW)).toBe('2026-03-28');
      expect(resolveRateDate(new Date('2026-03-30T10:00:00Z'), rule, NOW)).toBe('2026-03-29');
    });
  });

  describe('terminal signals', () => {
    it('should return null when placedAt is undefined', () => {
      // WooCommerce orders can arrive without one; without this guard every
      // foreign-currency WC order throws and dies after ten retries.
      expect(resolveRateDate(undefined, rule, NOW)).toBeNull();
    });

    it('should return null for an Invalid Date rather than throwing', () => {
      expect(resolveRateDate(new Date('not-a-date'), rule, NOW)).toBeNull();
    });
  });

  describe('future clamp', () => {
    it('should clamp a future placedAt to today in Warsaw', () => {
      // Load-bearing, not defensive: a future endPeriod makes ECB answer with
      // a months-stale rate at HTTP 200 and no error signal.
      const now = new Date('2026-08-14T12:00:00Z');
      expect(resolveRateDate(new Date('2026-12-24T09:00:00Z'), rule, now)).toBe('2026-08-14');
    });

    it('should not clamp when the candidate is already in the past', () => {
      const now = new Date('2026-08-14T12:00:00Z');
      expect(resolveRateDate(new Date('2026-08-14T09:00:00Z'), rule, now)).toBe('2026-08-13');
    });

    it('should return today when the candidate lands exactly on today', () => {
      // placedAt is tomorrow, so the candidate IS today - the boundary of the
      // clamp, pinned explicitly rather than left incidental.
      const now = new Date('2026-08-14T12:00:00Z');
      expect(resolveRateDate(new Date('2026-08-15T09:00:00Z'), rule, now)).toBe('2026-08-14');
    });
  });

  describe('calendar neutrality', () => {
    it('should not reference the Polish working-day calendar at all', () => {
      // Asserted structurally rather than with a spy: the point is that the
      // dependency does not EXIST, and a spy would only prove one input path
      // avoided it. A future contributor "fixing" the Monday -> Sunday case by
      // reaching for `previousWorkingDay` fails here, which is where the
      // reasoning lives (a shared Polish calendar silently staled every ECB
      // rate on a Polish-only holiday).
      const source = readFileSync(join(__dirname, '..', 'rate-date-resolution.ts'), 'utf8');
      const imports = source
        .split('\n')
        .filter((line) => line.trimStart().startsWith('import '))
        .join('\n');

      expect(imports).not.toContain('@openlinker/shared/date');
      expect(source).not.toContain('previousWorkingDay(');
      expect(source).not.toContain('isPlWorkingDay(');
    });
  });
});
