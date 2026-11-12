/**
 * Shopify Not Supported Exception
 *
 * An operation the Shopify integration deliberately does not implement (a
 * product write on the ProductMaster, a filter the Admin API cannot express).
 * Thrown rather than silently no-op'd, because a silent no-op would read as
 * "done". Not retryable: the same call is refused the same way.
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
