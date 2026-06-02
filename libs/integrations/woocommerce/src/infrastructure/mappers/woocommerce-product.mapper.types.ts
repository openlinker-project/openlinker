/**
 * WooCommerce Product Mapper Types
 *
 * Construction-time options for WooCommerceProductMapper. Kept in a separate
 * file per docs/engineering-standards.md § Type Definitions in Separate Files.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 */

export interface WooCommerceProductMapperOptions {
  /** ISO 4217 currency code assigned to every product (e.g. 'PLN'). null when absent. */
  currency?: string;
}
