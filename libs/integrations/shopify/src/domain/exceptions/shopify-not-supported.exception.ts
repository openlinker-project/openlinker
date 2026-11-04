/**
 * Shopify Not Supported Exception
 *
 * An operation this prototype adapter deliberately does not implement. Thrown
 * rather than silently no-op'd, because a silent no-op would read as "done".
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyNotSupportedException extends Error {
  constructor(readonly operation: string) {
    super(`Shopify does not support "${operation}" in this version of the integration`);
    this.name = 'ShopifyNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
