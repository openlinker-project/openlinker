/**
 * Erli Rate Limit Exception
 *
 * Thrown when Erli's `429 Too Many Requests` survives the client's bounded
 * retry budget. `retryAfterMs` carries the parsed `Retry-After` hint (ms) when
 * Erli supplied a numeric one. `429` is Erli's only documented rate-limit
 * signal (load-dependent, no published quota — ADR-022).
 *
 * **Classifier intent (D4 / #984+):** maps to `RetryClassifierPort
 * .isNonRetryable = false` (retryable) — the sync-job runner may retry the job
 * later, beyond the in-request budget the client already exhausted.
 *
 * @module libs/integrations/erli/src/domain/exceptions
 */
export class ErliRateLimitException extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'ErliRateLimitException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErliRateLimitException);
    }
  }
}
