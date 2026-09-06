/**
 * Missing Order Item Mapping Error
 *
 * Thrown when core cannot resolve an external-only IncomingOrder item reference
 * (`IncomingOrderItemRef`) to an internal OpenLinker product (and optional variant).
 *
 * This is a non-retryable error until the required mapping exists.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
import type { IncomingOrderItemRef } from '../types/incoming-order.types';
import type { OrderRecordStatus } from '../types/order-record.types';

export class MissingOrderItemMappingError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly productRef: IncomingOrderItemRef,
    public readonly resolutionHint?: string,
    /**
     * The `OrderRecordStatus` the caller has ALREADY persisted for this order
     * (#2928) — only populated by `OrderIngestionService`'s aggregate,
     * all-items-considered throw, never by `OrderItemRefResolverService`'s
     * per-reference throws (those are always the ordinary, self-healing
     * `'awaiting_mapping'` gap and leave this `undefined`).
     *
     * `'source_deleted'` means the master deleted the product a mapped
     * variant pointed at — a permanently unresolvable state (a recreate at
     * the master usually mints a new external id, so the old mapping never
     * heals) — as opposed to the ordinary `'awaiting_mapping'` gap, which a
     * later sync can still close. A caller that knows the difference (the
     * worker's `MarketplaceOrderSyncHandler`) uses it to stop retrying a
     * condition retrying cannot fix, instead of re-hydrating the same order
     * from the marketplace on every attempt for no progress.
     */
    public readonly recordStatus?: OrderRecordStatus,
  ) {
    super(
      `Missing mapping for order item productRef (connectionId=${connectionId}, type=${productRef.type}, externalId=${productRef.externalId})`,
    );
    this.name = 'MissingOrderItemMappingError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MissingOrderItemMappingError);
    }
  }
}

