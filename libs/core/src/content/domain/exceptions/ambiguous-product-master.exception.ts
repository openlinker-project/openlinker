/**
 * Ambiguous Product Master Exception
 *
 * Thrown when more than one active `ProductMaster` connection claims the same
 * product (#4068). Content is read from, and published back to, the product's
 * own master; with two claimants there is no rule that says which one is the
 * product's, and a wrong pick writes the description into another shop. So the
 * operation refuses instead of guessing. #1904 records this state as
 * unreachable through any supported workflow, which is why refusing costs
 * nothing in normal use.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class AmbiguousProductMasterException extends Error {
  constructor(
    public readonly productId: string,
    public readonly connectionIds: readonly string[],
  ) {
    super(
      `More than one ProductMaster connection claims product ${productId} (${connectionIds.join(', ')}); refusing to pick one.`,
    );
    this.name = 'AmbiguousProductMasterException';
    Error.captureStackTrace(this, this.constructor);
  }
}
