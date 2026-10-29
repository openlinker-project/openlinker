/**
 * Country names
 *
 * Country names in the app's language. English keeps the curated names from
 * the ISO list (they are the names operators already see); other languages
 * come from `Intl.DisplayNames`, falling back to the English name when the
 * runtime has none. Codes stay the ISO 3166-1 list's.
 *
 * @module shared/format
 */
import { getLocale } from '../i18n/active-locale';
import type { SupportedLocale } from '../i18n/i18n.types';
import { ISO_3166_1_COUNTRIES, type Iso3166Country } from '../lib/iso-3166-1-countries';
import { formattingLocale } from './format-locale';

const ENGLISH_NAME = new Map(ISO_3166_1_COUNTRIES.map((c) => [c.code, c.name]));

export function formatCountryName(code: string, locale: SupportedLocale = getLocale()): string {
  const upper = code.toUpperCase();
  if (locale === 'en') return ENGLISH_NAME.get(upper) ?? upper;
  try {
    const name = new Intl.DisplayNames([formattingLocale(locale)], { type: 'region' }).of(upper);
    if (name && name !== upper) return name;
  } catch {
    // Unknown region code or no DisplayNames support: fall back below.
  }
  return ENGLISH_NAME.get(upper) ?? upper;
}

/**
 * The full ISO list with names in the app's language, sorted for a picker.
 */
export function localizedCountries(locale: SupportedLocale = getLocale()): Iso3166Country[] {
  const collator = new Intl.Collator(formattingLocale(locale));
  return ISO_3166_1_COUNTRIES.map((c) => ({ code: c.code, name: formatCountryName(c.code, locale) })).sort(
    (a, b) => collator.compare(a.name, b.name),
  );
}
