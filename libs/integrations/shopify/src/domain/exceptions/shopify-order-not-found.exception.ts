/**
 * Shopify Order Not Found Exception
 *
 * `order(id:)` answered `null`: the order does not exist (or no longer
 * exists) on the shop. Shopify signals absence by a null node, never an error.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyOrderNotFoundException extends Error {
  constructor(
    readonly externalOrderId: string,
    readonly connectionId: string,
  ) {
    super(`Shopify order ${externalOrderId} not found (connection: ${connectionId})`);
    this.name = 'ShopifyOrderNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
