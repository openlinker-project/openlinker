/**
 * Mirakl Config Exception
 *
 * A configuration or programmer error raised before any request leaves the
 * client: missing credentials, an unusable shop id, a non-https base URL, or a
 * request path that resolves off the operator's host. Distinct from
 * `MiraklApiException`, which is an answer from Mirakl.
 *
 * Classifier intent: non-retryable (the same config fails the same way on every
 * attempt).
 *
 * @module libs/integrations/mirakl/src/domain/exceptions
 */
export class MiraklConfigException extends Error {
  constructor(
    message: string,
    public readonly connectionId?: string,
  ) {
    super(message);
    this.name = 'MiraklConfigException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiraklConfigException);
    }
  }
}
