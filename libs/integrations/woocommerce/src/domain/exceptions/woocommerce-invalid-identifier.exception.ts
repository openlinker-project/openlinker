/**
 * WooCommerce Invalid Identifier Exception
 *
 * Thrown by the canonical `toPositiveInt` helper when a value that is required
 * to be a WooCommerce resource id (product id, variation id) is not a finite
 * positive integer. A corrupted or non-numeric identifier mapping fails fast
 * here rather than silently producing a malformed request path like
 * `/products/NaN`.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceInvalidIdentifierException extends Error {
  constructor(
    message: string,
    readonly rawValue: unknown,
  ) {
    super(message);
    this.name = 'WooCommerceInvalidIdentifierException';
    Error.captureStackTrace(this, this.constructor);
  }
}
