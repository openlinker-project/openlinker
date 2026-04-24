/**
 * Amount Formatter
 *
 * Currency-aware number formatting. When `currency` is a non-empty ISO-4217
 * code, formats as localised currency; otherwise falls back to a bare numeric
 * representation with two fraction digits. Centralised so every surface that
 * renders money (order totals, line-item unit/line prices, offer prices)
 * produces the same output for the same input.
 *
 * @module apps/web/src/shared/format
 */

export function formatAmount(amount: number, currency: string | undefined): string {
  if (currency) {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  }
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
