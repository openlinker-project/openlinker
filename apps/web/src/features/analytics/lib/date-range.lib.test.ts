import { describe, expect, it } from 'vitest';
import { computePresetRange, derivePreset } from './date-range.lib';

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
