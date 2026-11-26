/**
 * Amazon Config Exception
 *
 * The connection's config or stored credentials cannot be used. Only an
 * operator edit changes that, so the retry classifier treats it as terminal.
 * The message names the problem, never a secret.
 *
 * @module libs/integrations/amazon/src/domain/exceptions
 */
export class AmazonConfigException extends Error {
  constructor(
    public readonly connectionId: string,
    detail: string,
  ) {
    super(`Amazon connection ${connectionId} is not usable: ${detail}`);
    this.name = 'AmazonConfigException';
    Error.captureStackTrace(this, this.constructor);
  }
}
