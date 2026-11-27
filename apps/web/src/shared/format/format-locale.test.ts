/**
 * Locale-aware shared formatters - unit tests
 *
 * The shared helpers follow the language they are given (and the app's
 * active language by default), not the browser's.
 *
 * @module shared/format
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setActiveLocale } from '../i18n/active-locale';
import { formatPlural } from '../i18n/plural';
import { formatAmount } from './format-amount';
import { formatAbsoluteDate, formatAbsoluteTime, formatDateTime } from './format-date';
import { formatCountryName, localizedCountries } from './format-country';
import { formatDurationMs } from './format-duration-ms';
import { formatRelativeTime } from './format-relative-time';
import { formatShipBy } from './format-ship-by';
import { formatTaxRate } from './format-tax-rate';

/** Intl separates groups with a narrow no-break space; compare on plain spaces. */
const plain = (text: string): string => text.replace(/\s/g, ' ').replace(/\u2212/g, '-');

const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('locale-aware shared formatters', () => {
  it('should format money with Polish separators', () => {
    expect(plain(formatAmount(12490, 'PLN', 'pl'))).toBe('12 490,00 zł');
  });

  it('should not group a four-digit amount in Polish', () => {
    // CLDR sets two minimum grouping digits for Polish: 1234 stays together.
    expect(plain(formatAmount(1234.5, 'PLN', 'pl'))).toBe('1234,50 zł');
    expect(plain(formatAmount(-1234.5, 'PLN', 'pl'))).toBe('-1234,50 zł');
  });

  it('should render absolute dates in Polish around midnight UTC', () => {
    expect(plain(formatAbsoluteDate('2026-03-28T23:59:00.000Z', 'pl'))).toBe('28 mar 2026');
    expect(plain(formatAbsoluteDate('2026-03-29T00:00:00.000Z', 'pl'))).toBe('29 mar 2026');
    expect(plain(formatAbsoluteTime('2026-03-28T23:59:00.000Z', 'pl'))).toBe('23:59');
  });

  it('should render consecutive date-times around midnight UTC in Polish', () => {
    expect(plain(formatDateTime('2026-03-29T00:30:00.000Z', 'pl'))).toBe('29 mar 2026, 00:30');
    expect(plain(formatDateTime('2026-03-29T03:30:00.000Z', 'pl'))).toBe('29 mar 2026, 03:30');
  });

  it('should use the Polish decimal separator for a tax rate', () => {
    expect(formatTaxRate('5.5', 'pl')).toBe('5,5%');
    expect(formatTaxRate('5.5', 'en')).toBe('5.5%');
    expect(formatTaxRate('zw', 'pl')).toBe('zw');
  });

  it('should render relative time in Polish', () => {
    const fiveMinutesAgo = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinutesAgo, NOW.getTime(), 'pl')).toBe('5 min temu');
    expect(formatRelativeTime(fiveMinutesAgo, NOW.getTime(), 'en')).toBe('5m ago');
    expect(formatRelativeTime(NOW.toISOString(), NOW.getTime(), 'pl')).toBe('przed chwilą');
  });

  it('should pick the Polish plural for days ago', () => {
    const ago = (days: number): string =>
      new Date(NOW.getTime() - days * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(ago(1), NOW.getTime(), 'pl')).toBe('1 dzień temu');
    expect(formatRelativeTime(ago(3), NOW.getTime(), 'pl')).toBe('3 dni temu');
    expect(formatRelativeTime(ago(3), NOW.getTime(), 'en')).toBe('3d ago');
  });

  it('should render the ship-by countdown in Polish', () => {
    expect(formatShipBy('2026-06-01T15:00:00.000Z', NOW, 'pl')?.remaining).toBe('3 godz. do terminu');
  });

  it('should not render "0m left" under a minute before the deadline', () => {
    expect(formatShipBy('2026-06-01T12:00:30.000Z', NOW, 'en')?.remaining).toBe('due now');
  });

  it('should say due now up to one minute past the deadline, then overdue', () => {
    expect(formatShipBy('2026-06-01T11:59:01.000Z', NOW, 'en')?.remaining).toBe('due now');
    expect(formatShipBy('2026-06-01T11:58:59.000Z', NOW, 'en')?.remaining).toBe('Overdue 1m');
  });

  it('should pluralise days in a Polish countdown', () => {
    expect(formatShipBy('2026-06-04T12:00:00.000Z', NOW, 'pl')?.remaining).toBe('3 dni do terminu');
  });

  it('should use the Polish decimal separator for durations', () => {
    expect(formatDurationMs(1200, 'pl')).toBe('1,2 s');
    expect(formatDurationMs(125_000, 'pl')).toBe('2 min 5 s');
  });

  it('should name countries in the app language', () => {
    expect(formatCountryName('DE', 'pl')).toBe('Niemcy');
    expect(formatCountryName('BA', 'en')).toBe('Bosnia and Herzegovina');
    expect(localizedCountries('pl').find((c) => c.code === 'DE')?.name).toBe('Niemcy');
    // Sorted by the language's collation; no picker test depends on the old curated order.
  });
});

describe('the active language reaches formatters called without a locale', () => {
  afterEach(() => setActiveLocale('en'));

  it('should format money, dates and times the Polish way once the app is Polish', () => {
    setActiveLocale('pl');
    expect(plain(formatAmount(12490, 'PLN'))).toBe('12 490,00 zł');
    expect(plain(formatAbsoluteDate('2026-10-30T15:00:00.000Z'))).toBe('30 paź 2026');
    expect(plain(formatAbsoluteTime('2026-10-30T15:00:00.000Z'))).toBe('15:00');
  });

  it('should read English dates day-first on a 24-hour clock', () => {
    expect(plain(formatDateTime('2026-10-30T15:00:00.000Z'))).toBe('30 Oct 2026, 15:00');
  });
});

describe('invalid timestamps', () => {
  it.each(['', 'garbage', '2026-13-45'])('should not throw for %j', (value) => {
    expect(() => formatAbsoluteDate(value, 'pl')).not.toThrow();
    expect(formatAbsoluteDate(value, 'pl')).toBe(value);
    expect(formatDateTime(value, 'en')).toBe(value);
    expect(formatAbsoluteTime(value, 'en')).toBe(value);
  });

  it('should not throw for null or undefined that slipped past the types', () => {
    expect(formatDateTime(null as unknown as string, 'en')).toBe('');
    expect(formatAbsoluteDate(undefined as unknown as string, 'en')).toBe('');
  });
});

describe('formatPlural', () => {
  const forms = {
    one: '{n} zamówienie',
    few: '{n} zamówienia',
    many: '{n} zamówień',
    other: '{n} zamówienia',
  };

  it('should choose the form from the value it prints', () => {
    expect(formatPlural(1.0004, forms, 'pl')).toBe('1 zamówienie');
    expect(formatPlural(1.5, forms, 'pl')).toBe('1,5 zamówienia');
  });
});
