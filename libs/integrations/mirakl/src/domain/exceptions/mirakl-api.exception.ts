/**
 * Mirakl API Exception
 *
 * A non-retryable Mirakl HTTP failure: a deterministic 4xx other than
 * 401/403/429. Mirakl answers these in two shapes, both observed on Empik
 * staging: `{ code, message, status }` (for example OR21 `ORDER_NOT_FOUND`) and
 * `{ message, status }` (OR23, request validation). `miraklCode` is set only for
 * the first shape, so callers branch on it, never on the message text.
 *
 * Classifier intent: non-retryable (`MiraklRetryClassifierAdapter`).
 *
 * `responseBody` is diagnostics only: it can echo submitted data, so it must
 * not be logged above `debug`.
 *
 * @module libs/integrations/mirakl/src/domain/exceptions
 */
export class MiraklApiException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly miraklCode?: string,
    public readonly miraklMessage?: string,
    public readonly responseBody?: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'MiraklApiException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiraklApiException);
    }
  }
}
