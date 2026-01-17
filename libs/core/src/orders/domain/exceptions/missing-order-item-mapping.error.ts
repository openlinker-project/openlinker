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

export class MissingOrderItemMappingError extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly productRef: IncomingOrderItemRef,
    public readonly resolutionHint?: string,
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

