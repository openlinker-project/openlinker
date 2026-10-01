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

  /**
   * True only when SHOPER reported the addressed resource absent (SPIKE-3638
   * M6): a `404` that carries Shoper's own `invalid_request` envelope. A bare
   * `404` - an HTML page, an empty body, a proxy in front of a wrong or moved
   * host - is NOT this, and must never be read as a deletion: that mistake
   * would stale a whole catalogue and pause live offers on a configuration
   * error. (Shoper answers a wrong PATH with `400`, not `404`, so a `404` with
   * the envelope really does mean "no such resource".)
   */
  isResourceNotFound(): boolean {
    return this.statusCode === 404 && this.errorCode === 'invalid_request';
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
