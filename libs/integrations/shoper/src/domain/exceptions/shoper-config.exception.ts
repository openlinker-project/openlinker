/**
 * ShoperConfigException
 *
 * Thrown when a connection cannot be turned into a working adapter because its
 * stored config or credentials are unusable (no valid `baseUrl`, no token).
 * The shape validators normally stop such a connection at save time; this is
 * the backstop for one that predates a rule or was edited around them.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperConfigException extends Error {
  constructor(
    readonly connectionId: string,
    detail: string,
  ) {
    super(`Shoper connection ${connectionId} is misconfigured: ${detail}`);
    this.name = 'ShoperConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
