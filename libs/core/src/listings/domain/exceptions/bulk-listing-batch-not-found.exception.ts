/**
 * Bulk Offer Creation Batch Not Found Exception
 *
 * Domain exception thrown when a BulkListingBatch with the specified
 * ID does not exist. Raised by the repository on update paths
 * (`incrementCounters`, `updateStatus`) that require the row to already
 * exist.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class BulkListingBatchNotFoundException extends Error {
  constructor(id: string) {
    super(`Bulk offer creation batch not found: ${id}`);
    this.name = 'BulkListingBatchNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
