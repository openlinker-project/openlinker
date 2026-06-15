/**
 * WooCommerce Resource Not Found Exception
 *
 * Thrown by WooCommerceProductMasterAdapter when an identifier mapping
 * for a given internal entity ID does not exist for this connection, or when
 * the WooCommerce API returns 404 for a resource that was expected to exist.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceResourceNotFoundException extends Error {
  constructor(
    message: string,
    readonly entityType: string,
    readonly id: string,
    readonly connectionId: string,
  ) {
    super(message);
    this.name = 'WooCommerceResourceNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
