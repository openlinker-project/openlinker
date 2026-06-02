/**
 * WooCommerce Unauthorized Exception
 *
 * Thrown by WooCommerceHttpClient when WooCommerce returns HTTP 401 or 403.
 * Signals that the consumer key / secret is invalid or lacks required scope.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceUnauthorizedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WooCommerceUnauthorizedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
