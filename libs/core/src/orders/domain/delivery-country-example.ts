/**
 * Delivery Country Example Projection (#3907)
 *
 * Pure reduction of the `items` and `totals` fragments of an order snapshot
 * into the anonymous example the delivery-line editor previews. Kept apart from
 * the repository so the arithmetic is unit-testable without a database, and so
 * the allowlist of what may leave the snapshot lives in one place: only item
 * label, amount and rate are read.
 *
 * @module libs/core/src/orders/domain
 */
import type { DeliveryCountryExample } from './types/delivery-country-facts.types';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toDeliveryCountryExample(
  items: unknown,
  totals: unknown
): DeliveryCountryExample | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const lines = items.flatMap((raw) => {
    const item = asRecord(raw);
    if (item === null) return [];
    const quantity = asFiniteNumber(item.quantity);
    const unit = asFiniteNumber(item.unitPriceGross) ?? asFiniteNumber(item.price);
    if (quantity === null || unit === null) return [];
    const label =
      typeof item.name === 'string' && item.name.trim() !== ''
        ? item.name
        : typeof item.sku === 'string'
          ? item.sku
          : '';
    const rate = typeof item.taxRate === 'string' && item.taxRate !== '' ? item.taxRate : null;
    return [{ name: label, gross: roundMoney(unit * quantity), rate }];
  });

  if (lines.length === 0) {
    return null;
  }

  const totalsRecord = asRecord(totals);
  const delivery =
    asFiniteNumber(totalsRecord?.shippingGross) ?? asFiniteNumber(totalsRecord?.shipping);

  return { lines, delivery };
}
