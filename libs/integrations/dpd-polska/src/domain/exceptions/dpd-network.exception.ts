/**
 * DPD Network Exception
 *
 * Thrown for transient DPDServices failures — `5xx`, timeouts, connection
 * errors, and rate-limit (`429`) exhaustion after the HTTP client's retry
 * budget. Also thrown for an indeterminate **create** outcome: a network/
 * timeout on `generatePackagesNumbers` is NOT auto-retried (no DPD-side
 * idempotency key → a retry could double-create a waybill and double-charge
 * COD), so it surfaces here for the caller to reconcile rather than re-POST.
 *
 * @module libs/integrations/dpd-polska/src/domain/exceptions
 */
export class DpdNetworkException extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'DpdNetworkException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DpdNetworkException);
    }
  }
}
