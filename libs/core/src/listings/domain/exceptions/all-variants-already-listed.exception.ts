/**
 * All Variants Already Listed Exception
 *
 * Domain exception raised by `BulkListingSubmitService.submit` when every
 * expanded job was excluded by `filterAlreadyListed` (#1741) because each
 * variant already carries an active offer mapping on the destination
 * connection. Kept distinct from `EmptyBulkSubmissionException` (#1933) —
 * that exception means the caller submitted nothing resolvable; this one
 * means the operator submitted a real selection that was entirely a
 * duplicate of what's already listed, which the generic "requires at least
 * one productId" message misrepresents as an empty selection.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class AllVariantsAlreadyListedException extends Error {
  constructor(public readonly skippedCount: number) {
    super(
      `All ${skippedCount} selected ${skippedCount === 1 ? 'variant is' : 'variants are'} already listed on this connection; nothing new to publish`
    );
    this.name = 'AllVariantsAlreadyListedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
