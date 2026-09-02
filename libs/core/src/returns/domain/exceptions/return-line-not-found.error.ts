/**
 * Return Line Not Found Error
 *
 * Raised when a custody write names a line that does not exist (#2370).
 *
 * Kept distinct from `ReturnNotFoundError` for the reason #2332 kept that one
 * distinct from `ReturnNotAttributedError`: telling an operator to attribute a
 * return that does not exist is a different instruction from telling them the
 * line they clicked is gone, and #2376 answers them with different codes.
 *
 * A domain error, not a Nest exception — core never constructs HTTP.
 *
 * @module domain/exceptions
 */
export class ReturnLineNotFoundError extends Error {
  constructor(public readonly lineId: string) {
    super(`Return line not found: ${lineId}`);
    this.name = 'ReturnLineNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}
