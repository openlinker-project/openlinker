/**
 * formatDurationMs - unit tests (#2611)
 *
 * The one thing that must not happen is an unmeasured duration rendering as a
 * zero. Every row predating the column is NULL, so a formatter that returned
 * '0 ms' would tell an operator those jobs ran instantly.
 */
import { describe, it, expect } from 'vitest';
import { formatDurationMs } from './format-duration-ms';

describe('formatDurationMs', () => {
  it('returns null for an absent measurement so callers render their own marker', () => {
    expect(formatDurationMs(null)).toBeNull();
    expect(formatDurationMs(undefined)).toBeNull();
  });

  it('distinguishes a real zero measurement from absence', () => {
    expect(formatDurationMs(0)).toBe('0 ms');
  });

  it('returns null for a value that cannot be a duration', () => {
    expect(formatDurationMs(-1)).toBeNull();
    expect(formatDurationMs(Number.NaN)).toBeNull();
    expect(formatDurationMs(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('renders sub-second values in milliseconds', () => {
    expect(formatDurationMs(1)).toBe('1 ms');
    expect(formatDurationMs(999)).toBe('999 ms');
  });

  it('renders sub-minute values in seconds with one decimal', () => {
    expect(formatDurationMs(1000)).toBe('1.0 s');
    expect(formatDurationMs(1250)).toBe('1.3 s');
    expect(formatDurationMs(59_400)).toBe('59.4 s');
  });

  it('renders minutes and hours for a long attempt', () => {
    expect(formatDurationMs(60_000)).toBe('1m 0s');
    expect(formatDurationMs(150_000)).toBe('2m 30s');
    expect(formatDurationMs(3_600_000)).toBe('1h 0m');
    expect(formatDurationMs(5_460_000)).toBe('1h 31m');
  });
});
