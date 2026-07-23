/**
 * Invalid Override Key Exception
 *
 * Domain exception raised by `BulkListingSubmitService` when a key in
 * `perVariantOverrides`, `perProductOverrides`, or `excludedVariantIds` does
 * not match the internal-variant-id shape `^ol_variant_[a-f0-9]+$` (#1741).
 * Rejecting malformed keys (`__proto__`, `constructor`, arbitrary strings) at
 * submit is a prototype-pollution guard and closes off keys that can never
 * resolve to a real variant.
 *
 * The controller maps this to HTTP 400 (bad input), the same way
 * `EmptyBulkSubmissionException` is mapped.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class InvalidOverrideKeyException extends Error {
  constructor(
    public readonly field: string,
    public readonly key: string
  ) {
    super(
      `${field} contains a key (${key}) that is not a valid internal variant id ` +
        `(expected ol_variant_{hex})`
    );
    this.name = 'InvalidOverrideKeyException';
    Error.captureStackTrace(this, this.constructor);
  }
}
