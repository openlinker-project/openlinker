/**
 * PrestaShop Truncated Read Exception
 *
 * Thrown when a paged collection read exhausts its page budget without reaching
 * the end of the collection. The WebService caps a collection read at its page
 * size and reports nothing about what it left out, so a short answer and a
 * complete one look identical: an order lost every line past the hundredth, a
 * product with 120 combinations reported 100, and a pack whose component stock
 * rows were cut read as 0 and published 0 (#2608, #2598).
 *
 * The paged reads close that by paging to the end. This exception covers the one
 * case paging cannot: the collection is larger than any budget we are willing to
 * spend on it, or the shop ignores the paging clause and keeps answering with the
 * same full page. Both must be louder than a short answer, because the caller
 * would otherwise act on data it believes is whole.
 *
 * Deterministic: the collection does not shrink because a job retried, so a
 * retry re-reads the same pages and fails identically.
 * `PrestashopRetryClassifierAdapter` therefore classifies it as non-retryable.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopTruncatedReadException extends Error {
  constructor(
    public readonly resource: string,
    public readonly maxPages: number,
    public readonly pageSize: number,
    public readonly connectionId: string,
    detail?: string
  ) {
    super(
      `PrestaShop ${resource} read on connection ${connectionId} filled all ${maxPages} pages of ${pageSize} rows without reaching the end of the collection` +
        `${detail !== undefined ? ` (${detail})` : ''}. Refusing to return a truncated result.`
    );
    this.name = 'PrestashopTruncatedReadException';
    Error.captureStackTrace(this, this.constructor);
  }
}
