/**
 * useFormat Hook
 *
 * Every number, amount, date and duration an operator reads, formatted for
 * the active language. Replaces bare `toLocaleString()`, `toFixed()` for
 * display and hard-coded `'en-US'`.
 *
 * @module shared/i18n
 */
import { useMemo } from 'react';
import { formatAmount } from '../format/format-amount';
import { formatCountryName } from '../format/format-country';
import { formatAbsoluteDate, formatAbsoluteTime, formatDateTime } from '../format/format-date';
import { formatDurationMs } from '../format/format-duration-ms';
import { formatRelativeTime } from '../format/format-relative-time';
import { getBcp47Locale } from './locale';
import { listFormat, numberFormat } from './intl-cache';
import { useLocale } from './use-locale';

export interface Formatters {
  readonly number: (value: number, options?: Intl.NumberFormatOptions) => string;
  readonly percent: (fraction: number, options?: Intl.NumberFormatOptions) => string;
  readonly money: (amount: number, currency: string | undefined) => string;
  readonly date: (iso: string) => string;
  readonly dateTime: (iso: string) => string;
  readonly time: (iso: string) => string;
  readonly relativeTime: (iso: string) => string;
  readonly duration: (ms: number | null | undefined) => string | null;
  readonly list: (items: readonly string[], type?: Intl.ListFormatType) => string;
  readonly country: (code: string) => string;
}

export function useFormat(): Formatters {
  const { locale } = useLocale();
  return useMemo<Formatters>(() => {
    const tag = getBcp47Locale(locale);
    return {
      number: (value, options) => numberFormat(tag, options).format(value),
      percent: (fraction, options) =>
        numberFormat(tag, { style: 'percent', maximumFractionDigits: 1, ...options }).format(fraction),
      money: (amount, currency) => formatAmount(amount, currency, locale),
      date: (iso) => formatAbsoluteDate(iso, locale),
      dateTime: (iso) => formatDateTime(iso, locale),
      time: (iso) => formatAbsoluteTime(iso, locale),
      relativeTime: (iso) => formatRelativeTime(iso, undefined, locale),
      duration: (ms) => formatDurationMs(ms, locale),
      list: (items, type = 'conjunction') => listFormat(tag, { type }).format(items),
      country: (code) => formatCountryName(code, locale),
    };
  }, [locale]);
}
