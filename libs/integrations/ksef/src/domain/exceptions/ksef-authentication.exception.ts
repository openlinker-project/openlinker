/**
 * KSeF Authentication Exception
 *
 * Thrown for a live authentication failure against the KSeF API — a `401`/`403`
 * (revoked/expired authorization token, invalid qualified seal). This is the
 * runtime auth-attempt failure, NOT a credentials-shape problem: malformed
 * credentials are rejected up-front by `KsefConnectionCredentialsShapeValidator`
 * with the core `InvalidCredentialsShapeException`. Surfaced to the host
 * `AuthFailureClassifierPort` (C3, ADR-008) so a revoked credential flips the
 * connection to `needs_reauth` instead of retry-storming.
 *
 * Never carries credential material in its message or fields.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefAuthenticationException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'KsefAuthenticationException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefAuthenticationException);
    }
  }
}
