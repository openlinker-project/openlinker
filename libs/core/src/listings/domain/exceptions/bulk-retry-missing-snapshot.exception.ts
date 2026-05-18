/**
 * Bulk Retry Missing Snapshot Exception (#742)
 *
 * Thrown by `BulkOfferCreationRetryService.retryFailed` when a failed
 * `OfferCreationRecord` for a bulk batch has `request === null`. The
 * `request` snapshot is required to reconstruct the V2 payload for the
 * retry wave — without it, retry can't proceed for that record.
 *
 * Unreachable in normal flow: the `bulk_offer_creation_batches` table was
 * created in #734 so no pre-#734 rows exist, and the submit path always
 * writes a snapshot. If this ever fires it indicates a backfill /
 * migration / manual SQL mistake on `offer_creation_records.request`.
 * The sync-job runner classifies this exception as non-retryable, so the
 * operator sees an immediate structured-error stop rather than a silent
 * skip + lying batch summary.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class BulkRetryMissingSnapshotException extends Error {
  constructor(
    public readonly recordId: string,
    public readonly batchId: string,
  ) {
    super(
      `Cannot retry record ${recordId} on bulk batch ${batchId}: ` +
        `missing request snapshot (column is null). This is a documented ` +
        `invariant violation.`,
    );
    this.name = 'BulkRetryMissingSnapshotException';
    Error.captureStackTrace(this, this.constructor);
  }
}
