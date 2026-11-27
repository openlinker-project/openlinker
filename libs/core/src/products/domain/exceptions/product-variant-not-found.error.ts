/**
 * Product Variant Not Found Error
 *
 * Domain error: an operator write addressed a variant id OpenLinker has no row
 * for (#3588). Distinct from `MasterProductNotFoundError`, which is about a
 * product disappearing at its master.
 *
 * @module libs/core/src/products/domain/exceptions
 */
export class ProductVariantNotFoundError extends Error {
  constructor(public readonly variantId: string) {
    super(`Product variant not found: ${variantId}`);
    this.name = 'ProductVariantNotFoundError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ProductVariantNotFoundError);
    }
  }
}
