/**
 * Return Not Found Error
 *
 * Raised when a return id resolves to no row (#2332).
 *
 * Distinct from `ReturnNotAttributedError` on purpose: "there is no such return" and
 * "the return exists but OL cannot name its order" are different operator situations
 * with different remedies, and collapsing them would tell an operator to attribute a
 * return that does not exist. The attribution guard reads the row, so it is the first
 * place that distinction has to be made.
 *
 * @module domain/exceptions
 */
export class ReturnNotFoundError extends Error {
  constructor(public readonly returnId: string) {
    super(`Return not found: ${returnId}`);
    this.name = 'ReturnNotFoundError';
    Error.captureStackTrace(this, this.constructor);
  }
}
