/**
 * Missing Order Item Mapping Error
 *
 * Thrown when core cannot resolve an external-only IncomingOrder item reference
 * (`IncomingOrderItemRef`) to an internal OpenLinker product (and optional variant).
 *
 * This is a non-retryable error until the required mapping exists.
 *
 * **`resolutionHint` is IN the message (#3365).** It was captured and read by
 * nobody, anywhere, so the operator-facing reason named the unresolvable id but
 * not where OpenLinker had looked for it - and the remedy is precisely to
 * create one of the mappings it names. That mattered less while each ref type
 * had exactly one source; since the `ShopProduct` fallback there can be two,
 * and "no Product mapping" and "no Product AND no publish record" are different
 * situations with different fixes.
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
      `Missing mapping for order item productRef (connectionId=${connectionId}, type=${productRef.type}, externalId=${productRef.externalId})` +
        (resolutionHint ? `. Looked in: ${resolutionHint}` : ''),
    );
    this.name = 'MissingOrderItemMappingError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MissingOrderItemMappingError);
    }
  }
}

