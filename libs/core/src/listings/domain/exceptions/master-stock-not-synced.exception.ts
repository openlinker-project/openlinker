/**
 * Master Stock Not Synced Exception (#3851)
 *
 * Domain exception raised by `BulkListingSubmitService.submit` when every job
 * in a submission was left out because its stock was taken from master
 * inventory and OpenLinker holds no inventory position for the variant yet -
 * the master stock sync has not reached it. Kept distinct from
 * `AvailabilityUnknownError`, which reports a transient read failure a retry
 * can fix: here a retry changes nothing until the stock sync runs, and saying
 * "retry" would send the operator round the same loop.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class MasterStockNotSyncedException extends Error {
  constructor(public readonly skippedCount: number) {
    super(
      `${skippedCount === 1 ? 'The selected variant has' : `All ${skippedCount} selected variants have`} ` +
        `no stock synced from the master catalog yet; nothing was listed. Wait for the stock ` +
        `sync, or set the stock by hand.`
    );
    this.name = 'MasterStockNotSyncedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
