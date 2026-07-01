/**
 * Infakt Config Exception
 *
 * Thrown when a connection's config or credentials are invalid or missing
 * required fields (no `credentialsRef`, malformed `apiKey`, …). Distinct
 * from `InfaktApiError`, which covers rejections returned by the Infakt API
 * itself.
 *
 * @module libs/integrations/infakt/src/domain/exceptions
 */
export class InfaktConfigException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'InfaktConfigException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InfaktConfigException);
    }
  }
}
