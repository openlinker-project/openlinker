/**
 * WooCommerce Not Supported Exception
 *
 * Thrown when a WooCommerce adapter method has no equivalent in the WooCommerce
 * REST API (e.g. reserveInventory, releaseInventory, adjustInventory on variable
 * products without a variantId). Contains the unsupported `operation` name and
 * a human-readable `alternative`.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceNotSupportedException extends Error {
  constructor(operation: string, alternative: string) {
    super(`WooCommerce does not support '${operation}'. ${alternative}`);
    this.name = 'WooCommerceNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
