/**
 * KSeF API Exception
 *
 * Thrown for a non-retryable KSeF HTTP failure — a deterministic `4xx` other
 * than the auth statuses (`401`/`403`) that `KsefAuthenticationException`
 * covers. Retrying these can never succeed, so the client (C3) raises this
 * immediately without consuming its retry budget. Distinct from
 * `KsefConfigException` (a programmer/config error surfaced before any request
 * leaves the client).
 *
 * `responseBody` is diagnostics-only — it may echo back submitted data, so it
 * MUST NOT be logged above `debug`, and never carries credential material.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefApiException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'KsefApiException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefApiException);
    }
  }
}
