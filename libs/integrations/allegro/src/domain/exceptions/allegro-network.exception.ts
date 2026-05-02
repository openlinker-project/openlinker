/**
 * Allegro Network Exception
 *
 * Thrown when an HTTP request to Allegro could not reach the endpoint —
 * DNS failure, TLS error, connection refused, abort, fetch-level network
 * failure (`TypeError: fetch failed`). Distinct from
 * `AllegroAuthenticationException` (Allegro responded with 401) and
 * `AllegroApiException` (Allegro responded with non-2xx). Net-level
 * failures are transient: callers SHOULD retry. Never add this class to
 * non-retryable allowlists. (#499)
 *
 * The original cause is preserved via the standard `Error.cause` option so
 * forensic logging can walk the chain.
 *
 * @module libs/integrations/allegro/src/domain/exceptions
 */
export class AllegroNetworkException extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AllegroNetworkException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AllegroNetworkException);
    }
  }
}
