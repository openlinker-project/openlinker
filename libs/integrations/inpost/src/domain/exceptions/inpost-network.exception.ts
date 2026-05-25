/**
 * InPost Network Exception
 *
 * Thrown for transient ShipX failures — `5xx`, timeouts, connection errors,
 * and rate-limit (`429`) exhaustion after the HTTP client's retry budget.
 * Transient → the job layer may retry.
 *
 * @module libs/integrations/inpost/src/domain/exceptions
 */
export class InpostNetworkException extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'InpostNetworkException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InpostNetworkException);
    }
  }
}
