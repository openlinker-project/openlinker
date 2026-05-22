/**
 * InPost Unauthorized Exception
 *
 * Thrown when ShipX rejects the request with `401 unauthorized` or
 * `403 access_forbidden` — a bad/expired API token or insufficient token
 * permissions. Not retryable.
 *
 * @module libs/integrations/inpost/src/domain/exceptions
 */
export class InpostUnauthorizedException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'InpostUnauthorizedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InpostUnauthorizedException);
    }
  }
}
