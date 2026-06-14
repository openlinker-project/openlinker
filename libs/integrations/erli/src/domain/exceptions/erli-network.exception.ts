/**
 * Erli Network Exception
 *
 * Thrown for a transient transport failure against the Erli API — a `5xx`,
 * timeout, or connection error. Two paths raise it (D3):
 *   - an **idempotent** request (GET/PATCH, or POST flagged `idempotent: true`)
 *     that exhausts the client's retry budget; or
 *   - a **non-idempotent** request (POST by default) on its first `5xx`/network
 *     error — raised IMMEDIATELY, without retry, so a blind retry can never
 *     double-create a resource.
 *
 * **Classifier intent (D4 / #984+):** maps to `RetryClassifierPort
 * .isNonRetryable = false` (retryable) — the sync-job runner may retry the job.
 *
 * @module libs/integrations/erli/src/domain/exceptions
 */
export class ErliNetworkException extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'ErliNetworkException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErliNetworkException);
    }
  }
}
