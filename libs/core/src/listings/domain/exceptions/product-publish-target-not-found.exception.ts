/**
 * Product Publish Target Not Found Exception
 *
 * Neutral domain exception a shop adapter throws when an **upsert** publish
 * (a command carrying `externalProductId`) targets a shop product that no
 * longer exists — e.g. a WooCommerce `PUT /products/{id}` that returns 404
 * because the product was deleted shop-side.
 *
 * Distinct from `ProductPublishRejectedException`: a rejection is a terminal
 * business failure (the input was refused), whereas a missing upsert target is
 * a *recoverable stale-mapping* condition. The core `ProductPublishExecutionService`
 * catches this, deletes the stale `ShopProduct` identifier mapping, and falls
 * back to a create so the variant can re-publish (rather than failing forever).
 *
 * The message carries only the adapter key and external id — never the
 * request/response body — so nothing sensitive leaks through it.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class ProductPublishTargetNotFoundException extends Error {
  constructor(
    /** Adapter key of the shop whose upsert target was missing (e.g. 'woocommerce.restapi.v3'). */
    public readonly adapterKey: string,
    /** The shop-native external product id that no longer exists. */
    public readonly externalProductId: string,
  ) {
    super(
      `Shop ${adapterKey} upsert target not found (externalProductId=${externalProductId}); stale mapping`,
    );
    this.name = 'ProductPublishTargetNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
