/**
 * WooCommerce Not Supported Exception
 *
 * Thrown by WooCommerceProductMasterAdapter for write operations that are
 * not implemented in this issue (#874). Write capability is covered by #879.
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
