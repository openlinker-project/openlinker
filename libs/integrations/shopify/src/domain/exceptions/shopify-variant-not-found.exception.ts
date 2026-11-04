/**
 * Shopify Variant Not Found Exception
 *
 * The mapped variant is no longer among the product's variants while the
 * product itself still resolves - an INFERRED absence of one variant, so it is
 * deliberately platform-native and not the neutral `MasterProductNotFoundError`,
 * which would stale the whole product.
 *
 * @module libs/integrations/shopify/src/domain/exceptions
 */

export class ShopifyVariantNotFoundException extends Error {
  constructor(
    readonly productId: string,
    readonly variantExternalId: string,
    readonly connectionId: string,
  ) {
    super(
      `Shopify variant ${variantExternalId} is not a variant of product ${productId} ` +
        `(connection: ${connectionId})`,
    );
    this.name = 'ShopifyVariantNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
