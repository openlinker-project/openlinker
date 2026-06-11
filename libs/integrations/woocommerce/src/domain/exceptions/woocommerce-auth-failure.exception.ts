/**
 * WooCommerce Auth Failure Exception
 *
 * Thrown when WooCommerce returns HTTP 401 or 403 during an order-processor
 * operation (e.g. customer provisioning, order creation). Signals that the
 * consumer key / secret is invalid or lacks required scope, and that the
 * connection needs re-authentication.
 *
 * Distinct from `WooCommerceUnauthorizedException` (which is thrown by the HTTP
 * client for any 401/403 at the transport layer) — this exception is the
 * order-processor adapter's re-throw boundary so the auth-failure classifier
 * can recognise it directly.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceAuthFailureException extends Error {
  constructor(message: string, public readonly connectionId: string) {
    super(message);
    this.name = 'WooCommerceAuthFailureException';
    Error.captureStackTrace(this, this.constructor);
  }
}
