/**
 * Master Product Not Found Error
 *
 * Neutral, platform-agnostic domain error meaning "this product no longer
 * resolves at its master" (#1599). Master `ProductMaster` adapters translate
 * their own platform not-found exception (PrestaShop / WooCommerce 404, or a
 * missing external-id mapping) into this single core-visible shape at the
 * `getProduct` port boundary — the repository-error-conversion pattern from
 * `docs/engineering-standards.md § Error Handling`. Core services catch THIS
 * (never a platform exception) to distinguish a permanent master-side deletion
 * from a transient failure and mark the product's variants stale.
 *
 * @module libs/core/src/products/domain/exceptions
 */
export class MasterProductNotFoundError extends Error {
  constructor(
    public readonly productId: string,
    public readonly connectionId: string,
    cause?: unknown,
  ) {
    super(`Product not found at master (productId=${productId}, connectionId=${connectionId})`, {
      cause,
    });
    this.name = 'MasterProductNotFoundError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MasterProductNotFoundError);
    }
  }
}
