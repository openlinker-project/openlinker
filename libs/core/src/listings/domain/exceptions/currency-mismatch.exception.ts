/**
 * Currency Mismatch Exception
 *
 * Domain exception raised by `BulkListingSubmitService` when a per-product
 * or per-variant override supplies a `price.currency` that diverges from the
 * batch-wide `sharedConfig.price.currency` (#1741). Currency is batch-wide by
 * design (the per-row currency select is removed), so a divergent per-row
 * currency is rejected at submit before any batch row is persisted.
 *
 * The controller maps this to HTTP 400 (bad input), the same way
 * `EmptyBulkSubmissionException` is mapped.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class CurrencyMismatchException extends Error {
  constructor(
    public readonly overrideKey: string,
    public readonly overrideCurrency: string,
    public readonly batchCurrency: string
  ) {
    super(
      `Override ${overrideKey} price currency (${overrideCurrency}) diverges from ` +
        `the batch currency (${batchCurrency}); currency is batch-wide`
    );
    this.name = 'CurrencyMismatchException';
    Error.captureStackTrace(this, this.constructor);
  }
}
