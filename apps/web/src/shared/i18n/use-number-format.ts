/**
 * useNumberFormat Hook
 *
 * Returns a memoised `Intl.NumberFormat` for the current locale. Replaces
 * the previously hardcoded `new Intl.NumberFormat('en-US')` in
 * `app-shell.tsx` so the formatter follows the locale seam rather than
 * being pinned to en-US (#612).
 *
 * Today the only locale is `'en'`, which maps to BCP 47 `'en-US'`. When
 * additional locales land, extend `localeToBcp47` — or replace it with a
 * proper resolver — without changing the public hook surface.
 *
 * @module shared/i18n
 */
import { useMemo } from 'react';
import { useTranslation } from './use-translation';
import type { LocaleCode } from './i18n.types';

export function useNumberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const { locale } = useTranslation();
  return useMemo(() => new Intl.NumberFormat(localeToBcp47(locale), options), [locale, options]);
}

function localeToBcp47(locale: LocaleCode): string {
  if (locale === 'en') return 'en-US';
  return locale;
}
