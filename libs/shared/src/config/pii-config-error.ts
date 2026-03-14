/**
 * PII Configuration Error
 *
 * Thrown when PII configuration is invalid or missing required values.
 *
 * @module libs/shared/src/config
 */
export class PiiConfigurationError extends Error {
  constructor(
    message: string,
    public readonly missingVariable?: string,
  ) {
    super(message);
    this.name = 'PiiConfigurationError';
    Error.captureStackTrace(this, this.constructor);
  }
}
