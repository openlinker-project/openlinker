/**
 * ShoperOrderModifiedException
 *
 * Thrown when the recovery pass finds an order carrying our marker whose lines do
 * not match what we would create, but whose status is no longer the one
 * OpenLinker created it in. A line-count mismatch alone is also what a merchant
 * editing the order looks like (removing or splitting a line, moving it along the
 * workflow), and deleting that order would destroy their work, so the order is
 * left alone and the retry stops.
 *
 * Terminal: a retry finds the same order. An operator decides - delete it in the
 * shop if it really is a stale leftover, or map it to the OpenLinker order by hand.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperOrderModifiedException extends Error {
  constructor(
    readonly connectionId: string,
    readonly externalOrderId: string,
    readonly marker: string,
    readonly detail: string,
  ) {
    super(
      `Shoper order ${externalOrderId} on connection ${connectionId} carries "${marker}" but does not match ` +
        `the order to create (${detail}); it looks edited in the shop, so it was not deleted. ` +
        'Delete it in the shop if it is a stale leftover, then re-run the sync.',
    );
    this.name = 'ShoperOrderModifiedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
