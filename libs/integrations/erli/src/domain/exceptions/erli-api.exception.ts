/**
 * Erli API Exception
 *
 * Thrown for a non-retryable Erli HTTP failure — a deterministic `4xx` other
 * than `401`/`403`/`429` (e.g. `400` bad request, `404`, `409`, `422`
 * validation). Retrying these can never succeed, so the client raises this
 * immediately without consuming its retry budget.
 *
 * **Classifier intent (D4 / #984+):** maps to `RetryClassifierPort
 * .isNonRetryable = true` — the sync-job runner must NOT re-run a job that
 * failed this way. Also reused as the constructor guard for a non-HTTPS
 * `baseUrl` (a config error surfaced before any request leaves).
 *
 * **`responseBody` is diagnostics-only**: it may echo back submitted data, so
 * it MUST NOT be logged above `debug`.
 *
 * @module libs/integrations/erli/src/domain/exceptions
 */
export class ErliApiException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'ErliApiException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErliApiException);
    }
  }
}
