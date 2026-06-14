/**
 * Erli Authentication Exception
 *
 * Thrown when Erli rejects the static API key — `401 Unauthorized` or
 * `403 Forbidden`. Erli has no token-refresh flow (ADR-025: static bearer
 * key), so this is never retried inside the client.
 *
 * **Classifier intent (D4 / #984+):** maps to `AuthFailureClassifierPort
 * .isCredentialRejected = true` so the sync-job runner flags the connection
 * `needs_reauth` (#819 / ADR-008), AND to `RetryClassifierPort.isNonRetryable
 * = true` so the failing job is not retried. Without that registration the
 * operator never learns the key is wrong — which is the whole point of #819.
 *
 * @module libs/integrations/erli/src/domain/exceptions
 */
export class ErliAuthenticationException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'ErliAuthenticationException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErliAuthenticationException);
    }
  }
}
