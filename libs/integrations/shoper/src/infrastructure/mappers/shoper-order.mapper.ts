/**
 * Shoper Order Mapper
 *
 * Pure mapping of the neutral `OrderCreate` onto Shoper's order shapes. No I/O
 * and no identifier mapping - the adapter supplies resolved ids.
 *
 * Amounts: a Shoper order line's `price` is the GROSS unit price (verified:
 * a 23% line priced 214.35 sums to 214.35). The buyer-paid price passes through
 * untouched (ADR-014, SPIKE-3638 O4). Core computes no net/gross and this
 * mapper does not either (ADR-063 §5): a net-priced line needs the source's own
 * gross figure (`unitPriceGross`), and without one the order is refused.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { Address, OrderItem, PriceTaxTreatment } from '@openlinker/core/orders';

import type { ShoperOrderAddress, ShoperTax } from '../../domain/types/shoper-api.types';
import { mapShoperTaxRow } from './shoper-tax-rate.mapper';

const ISO2 = /^[A-Za-z]{2}$/;

/**
 * Shoper REQUIRES a phone on both addresses (live: an empty one is a 400 naming
 * `phone`). The address's own wins; `fallbackPhone` is the OTHER address's, so a
 * source that states one phone still fills both. Never invented.
 */
export function mapShoperOrderAddress(address: Address, fallbackPhone?: string): ShoperOrderAddress {
  return {
    firstname: address.firstName ?? '',
    lastname: address.lastName ?? '',
    company: address.company ?? '',
    street1: address.address1,
    street2: address.address2 ?? '',
    city: address.city,
    postcode: address.postalCode,
    state: address.state ?? '',
    country_code: ISO2.test(address.country.trim()) ? address.country.trim().toUpperCase() : '',
    phone: nonEmpty(address.phone) ?? nonEmpty(fallbackPhone) ?? '',
    tax_identification_number: address.taxId ?? '',
  };
}

/**
 * The gross unit price to write on the line, or `null` when the order does not
 * state one (a net-priced line with no source-reported gross figure).
 */
export function resolveGrossUnitPrice(
  item: Pick<OrderItem, 'price' | 'unitPriceGross'>,
  taxTreatment: PriceTaxTreatment | undefined,
): number | null {
  if (item.unitPriceGross !== undefined) {
    return item.unitPriceGross;
  }
  return taxTreatment === 'exclusive' ? null : item.price;
}

/** The `/taxes` row spelling an ADR-063 rate code (`'23'`, `'zw'`, ...), or null. */
export function findShoperTaxForRate(
  table: ReadonlyMap<string, ShoperTax>,
  rateCode: string,
): ShoperTax | null {
  const wanted = rateCode.trim().toLowerCase();
  for (const row of table.values()) {
    const mapped = mapShoperTaxRow(row);
    if (mapped.ok && mapped.code === wanted) {
      return row;
    }
  }
  return null;
}

/** Cents-accurate sum of lines and shipping, for the reconciliation warning. */
export function expectedOrderSum(
  lines: ReadonlyArray<{ readonly price: number; readonly quantity: number }>,
  shippingCost: number,
): number {
  const cents = lines.reduce((sum, l) => sum + Math.round(l.price * 100) * l.quantity, 0);
  return (cents + Math.round(shippingCost * 100)) / 100;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
