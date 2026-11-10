/**
 * Shopify Stock Write Refused Exception (#3980)
 *
 * A stock write-back to a published product that cannot be made safely: an id
 * that is not a Shopify id, a product with several variants and no variant
 * mapping, a variant that does not track stock. Terminal for the retry
 * classifier: the same command fails the same way until someone changes the
 * shop or re-publishes.
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
