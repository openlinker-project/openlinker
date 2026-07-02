/**
 * KSeF Config Exception
 *
 * Thrown for a programmer/config error surfaced before any request leaves the
 * client (C3) — a missing `credentialsRef`, a malformed/empty credential
 * payload, or an unrecognised environment on a pre-existing connection row.
 * Distinct from
 * `KsefApiException` (a deterministic HTTP `4xx`) and
 * `KsefAuthenticationException` (a live auth rejection): a config error is not
 * an API response and must not be conflated with retry/auth-failure classifier
 * intent.
 *
 * Never carries credential material in its message.
 *
 * @module libs/integrations/ksef/src/domain/exceptions
 */
export class KsefConfigException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'KsefConfigException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, KsefConfigException);
    }
  }
}
