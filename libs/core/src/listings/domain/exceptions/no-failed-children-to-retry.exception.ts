/**
 * No Failed Children to Retry Exception (#742)
 *
 * Thrown by `BulkOfferCreationRetryService.retryFailed` when the addressed
 * batch exists but has zero `OfferCreationRecord` children at
 * `status='failed'` — i.e. nothing to retry.
 *
 * Maps to HTTP 409 at the controller boundary. Distinguishing 409 from 404
 * matters: the operator sees "batch exists, but you have nothing to retry"
 * instead of "batch not found".
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class NoFailedChildrenToRetryException extends Error {
  constructor(public readonly batchId: string) {
    super(`Batch ${batchId} has no failed children to retry`);
    this.name = 'NoFailedChildrenToRetryException';
    Error.captureStackTrace(this, this.constructor);
  }
}
