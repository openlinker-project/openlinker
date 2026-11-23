/**
 * Mirakl Offer File Policy
 *
 * Builds the two import files #4277 sends. Both are semicolon-separated with a
 * header line, which is what Empik staging accepted (SPIKE-4268):
 *
 * - STO01 `offer-sku;quantity`, changes only the stock.
 * - PRI01 `offer-sku;price`, changes only the price.
 *
 * Neither touches any other offer field, which is why they are used instead of
 * OF24: OF24 resets every field it does not receive (on staging a partial OF24
 * zeroed the quantity and reset description, lead time and logistic class).
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { MiraklOfferWriteKind } from '../types/mirakl-offer-write.types';

const COLUMN_BY_KIND: Readonly<Record<MiraklOfferWriteKind, string>> = {
  stock: 'quantity',
  price: 'price',
};

/** One CSV cell, quoted only when it carries a separator, quote or newline. */
function cell(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The import file for one kind, one line per offer. */
export function buildMiraklOfferFile(
  kind: MiraklOfferWriteKind,
  lines: ReadonlyArray<{ readonly offerSku: string; readonly value: string }>
): string {
  const rows = lines.map((line) => `${cell(line.offerSku)};${cell(line.value)}`);
  return [`offer-sku;${COLUMN_BY_KIND[kind]}`, ...rows].join('\n') + '\n';
}

/** A quantity as STO01 takes it: a whole number, never negative. */
export function formatMiraklQuantity(quantity: number): string {
  return String(Math.max(0, Math.floor(quantity)));
}

/** A price as PRI01 takes it: a dot decimal with two places. */
export function formatMiraklPrice(amount: string): string | null {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed.toFixed(2);
}
