/**
 * Stale Order Item Error
 *
 * Thrown when an incoming order item resolves to a canonical variant that was
 * deleted at the master (`ProductVariant.isStale === true`, #1599). Distinct
 * from `MissingOrderItemMappingError`: the mapping and the variant row exist —
 * the variant is a zombie. Surfacing this early (at resolution time) yields an
 * actionable reason instead of an opaque destination-shop rejection later.
 *
 * Non-retryable until the variant is restored (un-staled) at the master. Caught
 * by `OrderItemRefResolverService.tryResolve` and mapped to the same
 * `{ resolved: false, reason }` seam as a missing mapping.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
import type { IncomingOrderItemRef } from '../types/incoming-order.types';

export class StaleOrderItemError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly productRef: IncomingOrderItemRef,
    public readonly internalVariantId: string,
  ) {
    super(
      `Order item resolves to a variant deleted at the master (connectionId=${connectionId}, type=${productRef.type}, externalId=${productRef.externalId}, variantId=${internalVariantId})`,
    );
    this.name = 'StaleOrderItemError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StaleOrderItemError);
    }
  }
}
