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
import { formattingLocale } from './format-locale';

export function formatAbsoluteDate(iso: string, locale?: SupportedLocale): string {
  return new Date(iso).toLocaleDateString(formattingLocale(locale), { dateStyle: 'medium' });
}

export function formatDateTime(iso: string, locale?: SupportedLocale): string {
  return new Date(iso).toLocaleString(formattingLocale(locale), {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function formatAbsoluteTime(iso: string, locale?: SupportedLocale): string {
  return new Date(iso).toLocaleTimeString(formattingLocale(locale), { timeStyle: 'short' });
}
