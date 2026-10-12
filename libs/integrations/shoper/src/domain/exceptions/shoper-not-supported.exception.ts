/**
 * ShoperNotSupportedException
 *
 * Thrown by the Shoper adapter for a port method this milestone deliberately
 * does not implement (every write on `ProductMasterPort`, for instance). A
 * descriptive failure is the point: a silent no-op or an empty result would
 * read as "done" or "nothing there" to the caller.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperNotSupportedException extends Error {
  constructor(readonly operation: string) {
    super(`Shoper does not support "${operation}" in this version of the integration`);
    this.name = 'ShoperNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
