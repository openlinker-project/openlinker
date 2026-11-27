/**
 * Mirakl Authentication Exception
 *
 * Mirakl rejected the shop API key: 401 or 403. The key is static (no refresh
 * flow), so this is never retried inside the client. Note that a valid staging
 * key sent to production also answers 401, so a wrong `environment` surfaces
 * here too.
 *
 * Classifier intent: credential rejection (`MiraklAuthFailureClassifierAdapter`,
 * ADR-008, flips the connection to `needs_reauth`) and non-retryable.
 *
 * @module libs/integrations/mirakl/src/domain/exceptions
 */
export class MiraklAuthenticationException extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'MiraklAuthenticationException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MiraklAuthenticationException);
    }
  }
}
