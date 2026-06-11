/**
 * WooCommerce Network Exception
 *
 * Thrown by WooCommerceHttpClient for transport-level failures: timeouts
 * (AbortController), network errors, and non-2xx responses after all retries
 * are exhausted (excluding 401/403/404 which have their own typed exceptions).
 *
 * `originalError` carries the underlying cause without shadowing the native
 * `Error.cause` property (Node 16.9+ / TS 4.6+ type it as `unknown`).
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceNetworkException extends Error {
  constructor(
    message: string,
    readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'WooCommerceNetworkException';
    Error.captureStackTrace(this, this.constructor);
  }
}
