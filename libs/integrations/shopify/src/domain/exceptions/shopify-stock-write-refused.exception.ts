/**
 * Shopify Stock Write Refused Exception
 *
 * A stock write-back to a published Shopify product cannot be applied as
 * asked: the target variant does not track stock, or the external id names a
 * product with several variants, or it names both a product and a variant.
 * Each is a fact about the shop or the mapping, so a retry cannot change it;
 * the message says what the operator has to fix.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyStockWriteRefusedException extends Error {
  constructor(
    readonly externalId: string,
    readonly connectionId: string,
    readonly reason: string,
  ) {
    super(`Shopify stock write-back for ${externalId} refused: ${reason} (connection: ${connectionId})`);
    this.name = 'ShopifyStockWriteRefusedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
