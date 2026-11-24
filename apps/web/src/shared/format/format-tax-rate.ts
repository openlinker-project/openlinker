/**
 * Tax Rate Formatter
 *
 * Renders the neutral per-line tax-rate code (#2054, ADR-063). The vocabulary
 * is percent-as-string plus exemption codes - `'23'`, `'8'`, `'5'`, `'0'`,
 * `'zw'`, `'np'`, `'oo'` - so a blanket `%` suffix is wrong: `'zw%'` is not a
 * rate any document carries.
 *
 * A numeric code reads as a percentage; an exemption code reads as itself.
 * `'0'` renders as `0%` rather than as a dash - it is a rate, and the dash is
 * reserved for absence (`AbsentValue`).
 *
 * Centralised so the order line-item column, the variant table and the invoice
 * panel's shipping preview cannot render the same code three different ways.
 *
 * The number follows the operator's language (`5,5%` in Polish).
 *
 * @module apps/web/src/shared/format
 */
import { numberFormat } from '../i18n/intl-cache';
import type { SupportedLocale } from '../i18n/i18n.types';
import { formattingLocale } from './format-locale';

export function formatTaxRate(code: string, locale?: SupportedLocale): string {
  if (!/^\d+(\.\d+)?$/.test(code)) return code;
  const value = numberFormat(formattingLocale(locale), { maximumFractionDigits: 2 }).format(
    Number(code),
  );
  return `${value}%`;
}
