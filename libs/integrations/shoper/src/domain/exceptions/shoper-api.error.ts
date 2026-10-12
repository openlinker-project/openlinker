/**
 * ShoperApiError
 *
 * Thrown for a non-2xx response from the Shoper REST API (a 3xx counts: the
 * client never follows redirects).
 *
 * Carries Shoper's own `error` code and a truncated `error_description` so an
 * operator sees what the shop said. The Bearer token is never part of the
 * message - nothing here has it.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */

/** Upper bound on the shop-supplied description echoed into a message. */
const MAX_DESCRIPTION_LENGTH = 200;

export class ShoperApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode?: string,
    errorDescription?: string,
  ) {
    super(buildMessage(statusCode, errorCode, errorDescription));
    this.name = 'ShoperApiError';
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * True when the shop rejected the credentials themselves (`401`, SPIKE-3638
   * C4) or the token lacks a granted area (`403 insufficient_scope`, C3). Both
   * are fixed by the operator in the shop's admin panel, not by retrying.
   */
  isAuthRejection(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

function buildMessage(statusCode: number, errorCode?: string, errorDescription?: string): string {
  const parts = [`Shoper API returned HTTP ${statusCode}`];
  if (errorCode !== undefined && errorCode.length > 0) {
    parts.push(errorCode);
  }
  if (errorDescription !== undefined && errorDescription.length > 0) {
    parts.push(errorDescription.slice(0, MAX_DESCRIPTION_LENGTH));
  }
  return parts.join(': ');
}
