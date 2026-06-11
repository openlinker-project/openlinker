/**
 * WooCommerce Order Processing Exception
 *
 * Thrown when order creation or update fails due to a data integrity
 * or upstream contract violation — distinct from WooCommerceConfigException
 * (connection misconfiguration) so the retry classifier routes them correctly
 * and does not disable the connection.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceOrderProcessingException extends Error {
  constructor(
    message: string,
    readonly connectionId: string,
  ) {
    super(message);
    this.name = 'WooCommerceOrderProcessingException';
    Error.captureStackTrace(this, this.constructor);
  }
}
