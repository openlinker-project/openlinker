/**
 * Subiekt Order Product Mapping Exception
 *
 * Thrown by `SubiektOrderProcessorAdapter.createOrder` when an order line's
 * internal `productId` has no `identifier_mappings` row for this Subiekt
 * connection — mirrors `PrestashopOrderProcessorManagerAdapter`'s "Product not
 * found in PrestaShop" guard. Without this the adapter would fall back to
 * `item.sku`, which only accidentally equals the Subiekt symbol (e.g. when the
 * product's SKU happened to round-trip unchanged through a marketplace) and
 * silently creates a ZK line pointing at the wrong towar, or an empty-symbol
 * service line, for a product that was never actually synced from this
 * connection.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */
export class SubiektOrderProductMappingException extends Error {
  constructor(
    public readonly productId: string,
    public readonly connectionId: string,
  ) {
    super(
      `No Subiekt product mapping for ${productId} on connection ${connectionId} — ` +
        `the product must be synced from this Subiekt connection (ProductMaster) before ` +
        `an order referencing it can be created here.`,
    );
    this.name = 'SubiektOrderProductMappingException';
    Error.captureStackTrace(this, this.constructor);
  }
}
