/**
 * Shopify Return Not Found Exception
 *
 * `node(id:)` answered null for a return id, or answered with something that
 * is not a `Return`. Shopify signals absence by a null node, never an error.
 *
 * Carries `statusCode: 404` on purpose: the returns status sweep counts a
 * source 404 and moves on rather than failing its page, and it recognises one
 * by that field, however the adapter's transport spells it.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyReturnNotFoundException extends Error {
  readonly statusCode = 404;

  constructor(
    readonly externalReturnId: string,
    readonly connectionId: string,
  ) {
    super(`Shopify return ${externalReturnId} not found (connection: ${connectionId})`);
    this.name = 'ShopifyReturnNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
