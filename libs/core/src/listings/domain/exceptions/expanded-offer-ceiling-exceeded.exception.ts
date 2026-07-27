/**
 * Expanded Offer Ceiling Exceeded Exception
 *
 * Domain exception raised by `BulkListingSubmitService.expandVariantJobs`
 * when the post-exclusion expanded offer count exceeds the hard ceiling
 * (#1741). The submitted-product cap is 100 (DTO), but per-variant fan-out
 * (#824) multiplies that, so the total offers a single batch can create is
 * bounded to protect the worker queue and downstream marketplace rate limits.
 *
 * The controller maps this to HTTP 422 (unprocessable), preserving the status
 * code the previous inline `UnprocessableEntityException` returned.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class ExpandedOfferCeilingExceededException extends Error {
  constructor(
    public readonly expandedCount: number,
    public readonly ceiling: number
  ) {
    super(
      `Bulk submission expands to ${expandedCount} offers, exceeding the ${ceiling} ceiling. ` +
        `Split the selection into smaller batches.`
    );
    this.name = 'ExpandedOfferCeilingExceededException';
    Error.captureStackTrace(this, this.constructor);
  }
}
