/**
 * Formatting locale
 *
 * The BCP 47 tag the shared formatters use when a caller passes none: the
 * app's active language (ADR-079), not the browser's. Read at call time; a
 * switch reaches every caller because `LocaleKeyed` remounts the routed tree
 * when the language changes (a memoised row would otherwise keep the old one).
 *
 * @module shared/format
 */
import { getLocale } from '../i18n/active-locale';
import { getBcp47Locale } from '../i18n/locale';
import type { SupportedLocale } from '../i18n/i18n.types';

export function formattingLocale(locale?: SupportedLocale): string {
  return getBcp47Locale(locale ?? getLocale());
}
