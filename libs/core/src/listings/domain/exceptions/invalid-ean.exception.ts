/**
 * Invalid EAN Exception
 *
 * Domain exception raised by `BulkListingSubmitService` when an included
 * variant's effective EAN/GTIN is present but fails its GS1 mod-10 check
 * digit (#1741). A bad check digit would let Allegro reject the offer at
 * create time or - worse - silently link the wrong catalog card, so it is
 * caught at submit before any batch row is persisted.
 *
 * The controller maps this to HTTP 400 (bad input), the same way
 * `EmptyBulkSubmissionException` is mapped.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class InvalidEanException extends Error {
  constructor(
    public readonly variantId: string,
    public readonly ean: string
  ) {
    super(
      `Variant ${variantId} has an EAN/GTIN (${ean}) with an invalid GS1 check digit`
    );
    this.name = 'InvalidEanException';
    Error.captureStackTrace(this, this.constructor);
  }
}
