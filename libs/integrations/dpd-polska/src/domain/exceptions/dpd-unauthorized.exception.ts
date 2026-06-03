/**
 * DPD Unauthorized Exception
 *
 * Thrown when DPDServices rejects the request with `401` (bad Basic-auth
 * pair / `MISSING_PERMISSION`) or `403`. Not retryable.
 *
 * @module libs/integrations/dpd-polska/src/domain/exceptions
 */
export class DpdUnauthorizedException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'DpdUnauthorizedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DpdUnauthorizedException);
    }
  }
}
