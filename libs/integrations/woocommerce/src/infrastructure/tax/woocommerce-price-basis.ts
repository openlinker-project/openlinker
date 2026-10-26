/**
 * WooCommerce Price Basis (ADR-077)
 *
 * OpenLinker's catalogue price is GROSS - what a buyer pays. A WooCommerce
 * store stores whatever its operator types, in the basis its own setting
 * names: `woocommerce_prices_include_tax`. This module holds the store-level
 * facts that decide the conversion and the two pure conversions themselves, so
 * the product master (WooCommerce -> OpenLinker) and the publisher (OpenLinker
 * -> WooCommerce) cannot convert in two different ways.
 *
 * Rounding is this adapter's job (ADR-063 § 5): a gross figure is rounded to
 * the store's own price decimals, the way WooCommerce shows it to a buyer; a
 * net figure written back is kept at 6 decimals, so the store's own gross
 * computation lands back on the exact gross OpenLinker holds.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/tax
 */

/** What a WooCommerce store's settings say about its prices. */
export interface WooCommerceStorePriceBasis {
  /** `woocommerce_calc_taxes = yes`. Off: every price is what the buyer pays. */
  readonly taxesEnabled: boolean;
  /** `woocommerce_prices_include_tax = yes`: stored prices are already gross. */
  readonly pricesIncludeTax: boolean;
  /** `woocommerce_price_num_decimals`, the store's display precision. */
  readonly priceDecimals: number;
  /** The store's base country (`woocommerce_default_country`), or `null`. */
  readonly storeCountry: string | null;
}

/** WooCommerce's own default when `woocommerce_price_num_decimals` is unset. */
export const WOOCOMMERCE_DEFAULT_PRICE_DECIMALS = 2;

/** Decimals a net price is written back with; enough to re-gross to the cent. */
const NET_PRICE_DECIMALS = 6;

/**
 * Whether a price in this store, for a product with this tax status, is
 * already what the buyer pays. A product the store does not tax
 * (`tax_status` `none`, or `shipping`, which taxes only the shipping) is
 * charged its stored price whatever the store setting.
 */
export function isStoredPriceGross(
  basis: WooCommerceStorePriceBasis,
  taxStatus: string | undefined
): boolean {
  return (
    !basis.taxesEnabled || basis.pricesIncludeTax || taxStatus === 'none' || taxStatus === 'shipping'
  );
}

/**
 * The line-item tax class for a product or variation's `tax_class` field:
 * `''` and `'standard'` are the standard class (`''` on a line). A variation's
 * `'parent'` - or a missing value - inherits `parentTaxClass`.
 */
export function effectiveTaxClass(
  taxClass: string | undefined,
  parentTaxClass?: string | undefined
): string {
  if (taxClass === undefined || taxClass === 'parent') {
    return parentTaxClass === undefined ? '' : effectiveTaxClass(parentTaxClass);
  }
  return taxClass === 'standard' ? '' : taxClass;
}

/** Net -> gross at `ratePercent`, rounded half-up to the store's decimals. */
export function toGrossPrice(net: number, ratePercent: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((net * (1 + ratePercent / 100) + Number.EPSILON) * factor) / factor;
}

/** Gross -> net at `ratePercent`, as the decimal string WooCommerce stores. */
export function toNetPrice(gross: number, ratePercent: number): string {
  const net = gross / (1 + ratePercent / 100);
  return String(Math.round((net + Number.EPSILON) * 10 ** NET_PRICE_DECIMALS) / 10 ** NET_PRICE_DECIMALS);
}
