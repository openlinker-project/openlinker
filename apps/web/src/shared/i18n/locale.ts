/**
 * Locale resolution helpers
 *
 * Maps the app's `LocaleCode` to a BCP 47 language tag for `Intl.*`
 * formatters. The single source of truth consumers use when building per-row
 * formatters with dynamic options (currency, date) — instead of mirroring the
 * `'en' → 'en-US'` mapping inline (#783).
 *
 * @module shared/i18n
 */
import type { LocaleCode } from './i18n.types';

/**
 * Resolve a `LocaleCode` to a BCP 47 language tag. Today `'en'` → `'en-US'`;
 * extend here as locales land. Both `useNumberFormat` and inline `Intl.*`
 * formatters route through this so locale resolution stays in one place.
 */
export function getBcp47Locale(locale: LocaleCode): string {
  if (locale === 'en') return 'en-US';
  return locale;
}
