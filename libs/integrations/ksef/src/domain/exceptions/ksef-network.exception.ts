/**
 * KSeF Network Exception
 *
 * Thrown for a transient transport failure against the KSeF API — DNS/TLS
 * failure, connection refused, request timeout/abort, or a refresh attempt that
 * could not reach the auth endpoint. Mirrors the Allegro precedent (#499):
 * surfaced as a RETRYABLE error so the worker's retry classifier backs off and
 * retries rather than marking the job dead, which is reserved for a genuine
 * `KsefAuthenticationException` (credential rejection).
 *
 * Never carries credential material in its message.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefNetworkException extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    options?: { cause?: Error },
  ) {
    super(message);
    this.name = 'KsefNetworkException';
    if (options?.cause) {
      this.cause = options.cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefNetworkException);
    }
  }
}
