/**
 * OAuth Code Exchange Exception
 *
 * Neutral domain exception thrown by an `OAuthCompletionPort` implementation
 * when the provider rejects the authorization code or client credentials
 * (a non-OK token-endpoint response). It exists so the plugin can signal
 * "this is a client-side / 4xx failure, not a transient outage" without
 * depending on `@nestjs/common`: the host's `OAuthConnectionService` maps it
 * to a `BadRequestException` (400), while any other failure (network/timeout)
 * falls through to a 500 — preserving the pre-relocation status semantics
 * (#859).
 *
 * @module libs/core/src/integrations/domain/exceptions
 */
export class OAuthCodeExchangeException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthCodeExchangeException';
    Error.captureStackTrace(this, this.constructor);
  }
}
