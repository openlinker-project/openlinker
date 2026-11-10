/**
 * No Product Master Adapter Exception
 *
 * Thrown when content must be read from or published to the product's master
 * but no active `ProductMaster` connection claims the product (#4068): none is
 * registered, or the one the product comes from is disabled or has the
 * capability switched off. A configuration gap rather than a runtime failure
 * of the underlying adapter.
 *
 * @module libs/core/src/content/domain/exceptions
 */
export class NoProductMasterAdapterException extends Error {
  constructor(
    public readonly productId: string,
    public readonly fieldKey: string,
  ) {
    super(
      `No active ProductMaster connection claims this product; cannot read or publish its content (productId=${productId} fieldKey=${fieldKey}). Enable the ProductMaster capability on the connection the product comes from.`,
    );
    this.name = 'NoProductMasterAdapterException';
    Error.captureStackTrace(this, this.constructor);
  }
}
