/**
 * ShoperVariantRequiredException
 *
 * Thrown when a stock write targets a multi-variant product without naming the
 * variant. Deterministic for that call - the stock rows exist, the caller just
 * did not say which one - so it is terminal; writing the first row would move
 * stock of the wrong variant.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperVariantRequiredException extends Error {
  constructor(
    readonly productId: string,
    readonly connectionId: string,
  ) {
    super(
      `Product ${productId} has several stock rows on connection ${connectionId}; ` +
        `pass the variantId of the one to adjust`,
    );
    this.name = 'ShoperVariantRequiredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
