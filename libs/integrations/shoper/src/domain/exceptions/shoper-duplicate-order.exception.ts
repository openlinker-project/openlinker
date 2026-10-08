/**
 * ShoperDuplicateOrderException
 *
 * Thrown when more than one Shoper order already carries the OpenLinker marker
 * of the order being created. Something created a duplicate before this
 * guard existed (or by hand), and the shop now holds several candidate orders
 * for one sale. Picking one silently could keep an incomplete order and drop
 * the real one, so an operator decides which to keep; terminal, because a retry
 * finds the same orders.
 *
 * @module libs/integrations/shoper/src/domain/exceptions
 */
export class ShoperDuplicateOrderException extends Error {
  constructor(
    readonly connectionId: string,
    readonly internalOrderId: string,
    readonly externalOrderIds: readonly string[],
  ) {
    super(
      `Shoper connection ${connectionId} already holds ${externalOrderIds.length} orders for ` +
        `OpenLinker order ${internalOrderId} (Shoper orders ${externalOrderIds.join(', ')}). ` +
        'Delete the extra ones in the shop, keeping the complete one, then re-run the sync.',
    );
    this.name = 'ShoperDuplicateOrderException';
    Error.captureStackTrace(this, this.constructor);
  }
}
