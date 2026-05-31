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
import type { OrderRef } from '@openlinker/core/orders';

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
