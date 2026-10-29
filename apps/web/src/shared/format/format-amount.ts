/**
 * Amount formatting
 *
 * Formats a money amount in the app's language. The currency is the
 * amount's own; only the separators and symbol placement follow the
 * operator's language.
 *
 * @module shared/format
 */
import type { SupportedLocale } from '../i18n/i18n.types';
import { formattingLocale } from './format-locale';

export function formatAmount(
  amount: number,
  currency: string | undefined,
  locale?: SupportedLocale,
): string {
  const tag = formattingLocale(locale);
  if (currency) {
    return new Intl.NumberFormat(tag, { style: 'currency', currency }).format(amount);
  }
  return new Intl.NumberFormat(tag, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
