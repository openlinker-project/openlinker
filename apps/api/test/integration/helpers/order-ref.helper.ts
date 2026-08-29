/**
 * Order-ref test helpers (integration suite).
 *
 * Single home for the #909 `OrderRef` contract assertion: `OrderRef.orderId`
 * carries the destination-native external order id (e.g. the PrestaShop numeric
 * order id), not an internal OpenLinker id — idempotency and the
 * external↔internal mapping write are owned by `OrderSyncService`. Kept here so
 * the contract is encoded once instead of duplicated per int-spec.
 *
 * @module apps/api/test/integration/helpers
 */
import type { OrderRef, OrderSyncResult } from '@openlinker/core/orders';

/**
 * Parse the destination-native PrestaShop numeric `id_order` from an `OrderRef`
 * (#909). Throws if the id is not a positive integer.
 */
export function destinationOrderIdFromRef(orderRef: Pick<OrderRef, 'orderId'>): number {
  const parsed = Number(orderRef.orderId);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`PS-side order id not a positive integer: '${orderRef.orderId}'`);
  }
  return parsed;
}

/**
 * Render a human-readable reason for a non-`success` {@link OrderSyncResult}.
 *
 * `OrderSyncResult` gained a third, terminal `'skipped_cancelled'` arm in #2284,
 * so `result.error` is no longer reachable from a bare `status !== 'success'`
 * narrowing. Int-specs use this in their diagnostic throw so a cancelled-at-source
 * skip reports itself as such instead of being mislabelled a transport failure.
 */
export function describeUnsuccessfulSync(result: OrderSyncResult): string {
  switch (result.status) {
    case 'failed':
      return `failed: ${result.error.message}${result.error.code ? ` (${result.error.code})` : ''}`;
    case 'skipped_held':
      return `skipped_held: order is on hold ${result.holdId} (${result.holdReason})`;
    case 'skipped_cancelled':
      return `skipped_cancelled: source cancellation recorded at ${result.cancelledAt.toISOString()}`;
    case 'success':
      return 'success';
  }
}
