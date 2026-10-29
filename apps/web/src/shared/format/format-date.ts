/**
 * Date formatting
 *
 * Absolute dates and times in the app's language (ADR-079), rather than the
 * browser's, so the page reads in one language.
 *
 * @module shared/format
 * @see {@link formatRelativeTime} for relative ("5m ago") formatting
 */
import type { SupportedLocale } from '../i18n/i18n.types';
import { dateTimeFormat } from '../i18n/intl-cache';
import { formattingLocale } from './format-locale';

export function formatAbsoluteDate(iso: string, locale?: SupportedLocale): string {
  return dateTimeFormat(formattingLocale(locale), { dateStyle: 'medium' }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale?: SupportedLocale): string {
  return dateTimeFormat(formattingLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

export function formatAbsoluteTime(iso: string, locale?: SupportedLocale): string {
  return dateTimeFormat(formattingLocale(locale), { timeStyle: 'short' }).format(new Date(iso));
}
