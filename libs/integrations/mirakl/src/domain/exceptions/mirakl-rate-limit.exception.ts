/**
 * Mirakl Rate Limit Exception
 *
 * A 429 that outlived the client's retry budget. Mirakl counts limits per hour
 * and sends `Retry-After` in seconds; `retryAfterMs` carries the parsed, clamped
 * hint when one was sent.
 *
 * Classifier intent: retryable (the sync runner may try the job again later).
 *
 * @module libs/integrations/mirakl/src/domain/exceptions
 */
export class MiraklRateLimitException extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'MiraklRateLimitException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiraklRateLimitException);
    }
  }
}
