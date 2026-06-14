/**
 * Erli Config Exception
 *
 * Thrown for a programmer/config error surfaced before any request leaves the
 * client — an invalid or non-HTTPS `baseUrl`, or a request path that resolves
 * off the configured host. Distinct from `ErliApiException` (a deterministic
 * HTTP `4xx` from Erli): a config error is not an API response and must not be
 * conflated with the `RetryClassifierPort` intent of the HTTP exceptions.
 *
 * @module libs/integrations/erli/src/domain/exceptions
 */
export class ErliConfigException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'ErliConfigException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErliConfigException);
    }
  }
}
