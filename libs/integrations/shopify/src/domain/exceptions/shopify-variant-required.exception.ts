/**
 * Shopify Variant Required Exception
 *
 * A stock write named a product with several variants but no variant. Writing
 * the first variant would move the wrong variant's stock, so it is refused.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyVariantRequiredException extends Error {
  constructor(
    readonly productId: string,
    readonly connectionId: string,
  ) {
    super(
      `Shopify product ${productId} has several variants; the adjustment must name one ` +
        `(connection: ${connectionId})`,
    );
    this.name = 'ShopifyVariantRequiredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
