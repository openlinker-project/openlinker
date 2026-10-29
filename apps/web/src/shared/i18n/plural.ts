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
import { numberFormat, pluralRules } from './intl-cache';
import { interpolate, type InterpolationParams } from './interpolate';
import type { SupportedLocale } from './i18n.types';

const DISPLAY_FRACTION_DIGITS = 1000;

function roundForDisplay(count: number): number {
  return Math.round(count * DISPLAY_FRACTION_DIGITS) / DISPLAY_FRACTION_DIGITS;
}

export function selectPluralForm(count: number, forms: PluralForms, locale: SupportedLocale): string {
  // Select on the value `{n}` will print: 1.0004 prints "1", so it takes the
  // singular rather than a plural beside the digit one.
  const category = pluralRules(getBcp47Locale(locale)).select(roundForDisplay(count));
  return forms[category as keyof PluralForms] ?? forms.other;
}

export function formatPlural(
  count: number,
  forms: PluralForms,
  locale: SupportedLocale,
  params: InterpolationParams = {},
): string {
  const n = numberFormat(getBcp47Locale(locale)).format(count);
  return interpolate(selectPluralForm(count, forms, locale), { ...params, n });
}
