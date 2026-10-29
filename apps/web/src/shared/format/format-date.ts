/**
 * Date formatting
 *
 * Absolute dates and times in the app's language (ADR-079), rather than the
 * browser's, so the page reads in one language.
 *
 * `Intl.DateTimeFormat#format` throws a RangeError on an invalid date, where
 * `toLocaleString` returned the text "Invalid Date". These helpers sit behind
 * many render paths, so a malformed or empty timestamp from the API shows the
 * raw value instead of taking the page to an error boundary.
 *
 * @module shared/format
 * @see {@link formatRelativeTime} for relative ("5m ago") formatting
 */
import type { SupportedLocale } from '../i18n/i18n.types';
import { dateTimeFormat } from '../i18n/intl-cache';
import { formattingLocale } from './format-locale';

function formatWith(
  iso: string,
  options: Intl.DateTimeFormatOptions,
  locale: SupportedLocale | undefined,
): string {
  // `typeof` first: `new Date(null)` is the epoch, a valid but wrong date.
  const date = typeof iso === 'string' && iso !== '' ? new Date(iso) : null;
  if (date === null || Number.isNaN(date.getTime())) {
    return typeof iso === 'string' ? iso : '';
  }
  return dateTimeFormat(formattingLocale(locale), options).format(date);
}

export function formatAbsoluteDate(iso: string, locale?: SupportedLocale): string {
  return formatWith(iso, { dateStyle: 'medium' }, locale);
}

export function formatDateTime(iso: string, locale?: SupportedLocale): string {
  return formatWith(iso, { dateStyle: 'medium', timeStyle: 'short' }, locale);
}

export function formatAbsoluteTime(iso: string, locale?: SupportedLocale): string {
  return formatWith(iso, { timeStyle: 'short' }, locale);
}
