/**
 * Formatting locale
 *
 * The BCP 47 tag the shared formatters use when a caller passes none: the
 * app's active language (ADR-079), not the browser's. Read at call time, so
 * a language switch reaches every formatter on the next render.
 *
 * @module shared/format
 */
import { getLocale } from '../i18n/active-locale';
import { getBcp47Locale } from '../i18n/locale';
import type { SupportedLocale } from '../i18n/i18n.types';

export function formattingLocale(locale?: SupportedLocale): string {
  return getBcp47Locale(locale ?? getLocale());
}
