/**
 * Plurals
 *
 * Picks the plural form a count needs through `Intl.PluralRules` - Polish has
 * one, few and many (1 zamówienie, 2 zamówienia, 5 zamówień, 22 zamówienia) -
 * and fills `{n}` with the count formatted for the language. A form a copy
 * file lacks falls back to `other`, so a count never renders blank.
 *
 * @module shared/i18n
 */
import type { PluralForms } from './copy.types';
import { getBcp47Locale } from './locale';
import { interpolate, type InterpolationParams } from './interpolate';
import type { SupportedLocale } from './i18n.types';

export function selectPluralForm(count: number, forms: PluralForms, locale: SupportedLocale): string {
  const category = new Intl.PluralRules(getBcp47Locale(locale)).select(count);
  const form = (forms as unknown as Record<string, string | undefined>)[category];
  return form ?? forms.other;
}

export function formatPlural(
  count: number,
  forms: PluralForms,
  locale: SupportedLocale,
  params: InterpolationParams = {},
): string {
  const n = new Intl.NumberFormat(getBcp47Locale(locale)).format(count);
  return interpolate(selectPluralForm(count, forms, locale), { ...params, n });
}
