/**
 * Shop Product Mapping Conflict Exception
 *
 * Thrown by `ProductPublishExecutionService` when a first-publish mapping insert
 * loses a concurrency race AND the winning `ShopProduct` mapping points to a
 * DIFFERENT internal variant than the one being published (#1845). Distinct from
 * the benign same-variant duplicate (which is swallowed): a divergent mapping is
 * a genuine identity conflict that must not be silently ignored, so the publish
 * job fails instead of mis-linking two variants to one shop product.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class ShopProductMappingConflictException extends Error {
  constructor(
    public readonly externalProductId: string,
    public readonly connectionId: string,
    public readonly expectedInternalVariantId: string,
    public readonly actualInternalVariantId: string | null,
  ) {
    super(
      `Shop product ${externalProductId} on connection ${connectionId} is already ` +
        `mapped to variant ${actualInternalVariantId ?? 'unknown'}, not ${expectedInternalVariantId}`,
    );
    this.name = 'ShopProductMappingConflictException';
    Error.captureStackTrace(this, this.constructor);
  }
}
