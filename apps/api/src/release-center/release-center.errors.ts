/**
 * Release Center API errors
 *
 * Api-layer refusals that need a lookup the leaf context cannot make (it
 * imports no sibling), so they live beside the view service that makes it.
 *
 * @module apps/api/src/release-center
 */

export class UnknownReleaseConnectionError extends Error {
  constructor(
    public readonly itemKey: string,
    public readonly connectionId: string
  ) {
    super(`Step ${itemKey} names a connection that does not exist: ${connectionId}`);
    this.name = 'UnknownReleaseConnectionError';
    Error.captureStackTrace(this, this.constructor);
  }
}
