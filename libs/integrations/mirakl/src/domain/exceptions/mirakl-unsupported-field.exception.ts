/**
 * Mirakl Unsupported Field Exception
 *
 * An offer field update asked for a field this plugin does not write to Mirakl
 * (only the price is written, through PRI01). Deterministic, so the retry
 * classifier treats it as non-retryable.
 *
 * @module libs/integrations/mirakl/src/domain/exceptions
 */
export class MiraklUnsupportedFieldException extends Error {
  constructor(
    message: string,
    public readonly fields: readonly string[]
  ) {
    super(message);
    this.name = 'MiraklUnsupportedFieldException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiraklUnsupportedFieldException);
    }
  }
}
