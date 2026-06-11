/**
 * WooCommerce Config Exception
 *
 * Thrown when a WooCommerce connection is in an invalid configuration state
 * that prevents the adapter from being constructed — e.g. a missing
 * `credentialsRef` before the operator has saved credentials.
 *
 * Mirrors AllegroConfigException in libs/integrations/allegro, which uses the
 * same pattern for misconfigured connection state.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceConfigException extends Error {
  constructor(
    message: string,
    readonly connectionId: string,
  ) {
    super(message);
    this.name = 'WooCommerceConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
