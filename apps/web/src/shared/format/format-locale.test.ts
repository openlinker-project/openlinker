/**
 * Locale-aware shared formatters - unit tests
 *
 * The shared helpers follow the language they are given (and the app's
 * active language by default), not the browser's.
 *
 * @module shared/format
 */
import { describe, expect, it } from 'vitest';
import { formatAmount } from './format-amount';
import { formatCountryName, localizedCountries } from './format-country';
import { formatDurationMs } from './format-duration-ms';
import { formatRelativeTime } from './format-relative-time';
import { formatShipBy } from './format-ship-by';

const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('locale-aware shared formatters', () => {
  it('should format money with Polish separators', () => {
    expect(formatAmount(12490, 'PLN', 'pl').replace(/\s/g, ' ')).toBe('12 490,00 zł');
  });

  it('should render relative time in Polish', () => {
    const fiveMinutesAgo = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinutesAgo, 'pl', NOW.getTime())).toBe('5 min temu');
    expect(formatRelativeTime(fiveMinutesAgo, 'en', NOW.getTime())).toBe('5m ago');
    expect(formatRelativeTime(NOW.toISOString(), 'pl', NOW.getTime())).toBe('przed chwilą');
  });

  it('should render the ship-by countdown in Polish', () => {
    expect(formatShipBy('2026-06-01T15:00:00.000Z', NOW, 'pl')?.remaining).toBe('zostało 3 godz.');
  });

  it('should not render "0m left" under a minute before the deadline', () => {
    expect(formatShipBy('2026-06-01T12:00:30.000Z', NOW, 'en')?.remaining).toBe('due now');
  });

  it('should use the Polish decimal separator for durations', () => {
    expect(formatDurationMs(1200, 'pl')).toBe('1,2 s');
    expect(formatDurationMs(125_000, 'pl')).toBe('2 min 5 s');
  });

  it('should name countries in the app language', () => {
    expect(formatCountryName('DE', 'pl')).toBe('Niemcy');
    expect(formatCountryName('BA', 'en')).toBe('Bosnia and Herzegovina');
    expect(localizedCountries('pl').find((c) => c.code === 'DE')?.name).toBe('Niemcy');
  });
});
