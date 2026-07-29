/**
 * Duplicate Batch EAN Exception
 *
 * Domain exception raised by `BulkListingSubmitService` when two included
 * variants of a batch (of the same product or of different products) resolve
 * to the SAME effective EAN/GTIN (#1741). Two offers sharing one barcode would
 * collapse onto a single Allegro catalog card and lose their variant grouping,
 * so the collision is rejected at submit before any batch row is persisted.
 *
 * The controller maps this to HTTP 400 (bad input), the same way
 * `EmptyBulkSubmissionException` is mapped.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class DuplicateBatchEanException extends Error {
  constructor(
    public readonly ean: string,
    public readonly variantIds: string[]
  ) {
    super(
      `EAN/GTIN ${ean} is shared by more than one included variant ` +
        `(${variantIds.join(', ')}); each variant must have a distinct barcode ` +
        `so they group as separate offers instead of collapsing onto one catalog card`
    );
    this.name = 'DuplicateBatchEanException';
    Error.captureStackTrace(this, this.constructor);
  }
}
