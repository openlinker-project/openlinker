import { describe, expect, it } from 'vitest';
import {
  computePresetRange,
  computePreviousPeriodRange,
  derivePreset,
  isPreviousPeriodCovered,
  toUtcRangeInstants,
} from './date-range.lib';

const TODAY = new Date(2026, 7, 14); // 14 Aug 2026

describe('computePresetRange', () => {
  it('should compute an inclusive 7-day range', () => {
    expect(computePresetRange('7d', TODAY)).toEqual({ from: '2026-08-08', to: '2026-08-14' });
  });

  it('should compute an inclusive 30-day range', () => {
    expect(computePresetRange('30d', TODAY)).toEqual({ from: '2026-07-16', to: '2026-08-14' });
  });

  it('should compute an inclusive 90-day range', () => {
    expect(computePresetRange('90d', TODAY)).toEqual({ from: '2026-05-17', to: '2026-08-14' });
  });

  it('should cross a month/year boundary correctly', () => {
    const newYearsDay = new Date(2026, 0, 1); // 1 Jan 2026
    expect(computePresetRange('7d', newYearsDay)).toEqual({
      from: '2025-12-26',
      to: '2026-01-01',
    });
  });
});

describe('derivePreset', () => {
  it('should round-trip a preset-computed range back to that preset', () => {
    const range = computePresetRange('30d', TODAY);
    expect(derivePreset(range.from, range.to, TODAY)).toBe('30d');
  });

  it('should return "custom" for an arbitrary range', () => {
    expect(derivePreset('2026-03-01', '2026-04-15', TODAY)).toBe('custom');
  });

  it('should return "custom" for an incomplete range', () => {
    expect(derivePreset('', '2026-08-14', TODAY)).toBe('custom');
  });
});

describe('toUtcRangeInstants', () => {
  it('should map an inclusive local `to` day to the exclusive UTC instant after it', () => {
    // A `to` day of 2026-08-14 must include every order placed anywhere on
    // that day, so the API's exclusive bound is midnight the day after.
    expect(toUtcRangeInstants('2026-08-08', '2026-08-14')).toEqual({
      from: '2026-08-08T00:00:00.000Z',
      to: '2026-08-15T00:00:00.000Z',
    });
  });

  it('should cross a month/year boundary on the exclusive `to` bump', () => {
    expect(toUtcRangeInstants('2025-12-26', '2025-12-31')).toEqual({
      from: '2025-12-26T00:00:00.000Z',
      to: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('computePreviousPeriodRange', () => {
  it('should compute the immediately-preceding period of the same length for a 7-day range', () => {
    expect(computePreviousPeriodRange('2026-08-15', '2026-08-21')).toEqual({
      from: '2026-08-08',
      to: '2026-08-14',
    });
  });

  it('should compute the immediately-preceding period of the same length for a 30-day range', () => {
    expect(computePreviousPeriodRange('2026-07-23', '2026-08-21')).toEqual({
      from: '2026-06-23',
      to: '2026-07-22',
    });
  });

  it('should work for a single-day range', () => {
    expect(computePreviousPeriodRange('2026-08-21', '2026-08-21')).toEqual({
      from: '2026-08-20',
      to: '2026-08-20',
    });
  });

  it('should cross a month/year boundary', () => {
    expect(computePreviousPeriodRange('2026-01-01', '2026-01-07')).toEqual({
      from: '2025-12-25',
      to: '2025-12-31',
    });
  });
});

describe('isPreviousPeriodCovered', () => {
  it('should return false when earliestOrderDate is null', () => {
    expect(isPreviousPeriodCovered('2026-06-23', null)).toBe(false);
  });

  it('should return true when the previous period starts on or after the earliest order date', () => {
    expect(isPreviousPeriodCovered('2026-06-23', '2026-06-22T10:37:39.849Z')).toBe(true);
    expect(isPreviousPeriodCovered('2026-06-22', '2026-06-22T10:37:39.849Z')).toBe(true);
  });

  it('should return false when the previous period starts before the earliest order date', () => {
    expect(isPreviousPeriodCovered('2026-06-21', '2026-06-22T10:37:39.849Z')).toBe(false);
  });
});
