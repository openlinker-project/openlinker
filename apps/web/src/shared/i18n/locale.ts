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
 * Resolve a `LocaleCode` to a BCP 47 language tag. English is `en-GB`, not
 * `en-US`: the copy is British (ADR-079) and the operators are European, so
 * dates read day-first and times on a 24-hour clock. Extend here as locales
 * land. Both `useNumberFormat` and inline `Intl.*` formatters route through
 * this so locale resolution stays in one place.
 */
export function getBcp47Locale(locale: LocaleCode): string {
  if (locale === 'en') return 'en-GB';
  if (locale === 'pl') return 'pl-PL';
  return locale;
}
