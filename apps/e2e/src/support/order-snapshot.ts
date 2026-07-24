/**
 * Order-snapshot narrowing
 *
 * `OrderRecord.orderSnapshot` is an opaque `Record<string, unknown>` JSON blob
 * mirrored from the API (its exact shape is owned by the server and varies by
 * source platform). Specs that read specific fields must structurally narrow it,
 * which requires an `as unknown as T` cast. This helper is the ONE place that
 * cast lives, so it isn't hand-copied across specs — each caller supplies the
 * shape it expects and remains responsible for validating the fields it reads.
 *
 * @module support
 */
import type { OrderRecord } from '../api/api.types';

/** Narrow an order's opaque `orderSnapshot` blob to a caller-supplied shape. */
export function narrowOrderSnapshot<T>(order: OrderRecord): T {
  return order.orderSnapshot as unknown as T;
}
