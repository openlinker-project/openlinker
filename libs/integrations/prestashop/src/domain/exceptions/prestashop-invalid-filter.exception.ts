/**
 * PrestaShop Invalid Filter Exception
 *
 * Thrown when a caller passes a custom filter key the WebService cannot express.
 * PrestaShop silently ignores an unknown filter parameter and answers with an
 * unfiltered page, so a malformed key reads as success while returning the wrong
 * rows. That is not only a missed read: `updateStock` PATCHed `rows[0]` of such
 * a page, which wrote the published product's stock onto an unrelated product.
 * A wrong filter has to fail loudly (#2616).
 *
 * Deterministic by construction: every filter key in the package is a source
 * literal, so a retry re-sends the same key and fails identically.
 * `PrestashopRetryClassifierAdapter` therefore classifies this class as
 * non-retryable.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopInvalidFilterException extends Error {
  constructor(public readonly filterKey: string) {
    super(
      `Invalid PrestaShop filter key "${filterKey}". Pass the bare field name - the builder adds the filter[...] envelope itself.`
    );
    this.name = 'PrestashopInvalidFilterException';
    Error.captureStackTrace(this, this.constructor);
  }
}
