/**
 * WooCommerce tax-class types (#3505, G01-6)
 *
 * Wire shape of `GET /wp-json/wc/v3/taxes/classes` and the resolved lookup
 * `WooCommerceTaxClassResolver` hands the order processor.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/order-processor
 */

/** One row of `GET /wp-json/wc/v3/taxes/classes`. */
export interface WooCommerceTaxClassResponse {
  slug?: string;
  name?: string;
}

/** The store's tax classes, resolvable by the rate a line must be taxed at. */
export interface WooCommerceTaxClassTable {
  /**
   * The line-item `tax_class` value (`''` = standard) whose rate for
   * `country` is exactly `ratePercent`, or `null` when no class gives it.
   * `country` absent or empty matches only the store's wildcard rows.
   */
  resolve(country: string | undefined, ratePercent: number): string | null;
  /**
   * The effective rate (percent) a line of `lineTaxClass` (`''` = standard) is
   * taxed at in `country`, or `null` when the class is unknown to the store or
   * its rows for that country cannot be summarised as one rate (ADR-077). A
   * class with no row for the country taxes at 0 - the stock "Zero rate".
   */
  rateFor(lineTaxClass: string, country: string | undefined): number | null;
}
