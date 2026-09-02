/**
 * Order-scoped lock keys
 *
 * Key builders for the per-ORDER `SyncLockPort` locks, kept here — beside the
 * port that consumes them — because more than one bounded context needs the
 * SAME key string and none of them may value-import each other to get it.
 *
 * `shipmentDispatchLockKey` was declared in `@openlinker/core/shipping`
 * (#1917) and is still re-exported from there under its original name, so no
 * shipping caller changed. It moved because #2338's hold placement has to ask
 * "is a dispatch of this order in flight right now?", and `orders` cannot
 * value-import `shipping`: the shipping barrel already reaches back into
 * `@openlinker/core/orders` (which is why `order.types.ts` next door imports
 * `PickupPointType` as a TYPE, explicitly to avoid this), so a value import
 * would close a CJS require cycle between two barrels that both export runtime
 * classes. `sync` is a leaf both contexts already depend on, and it owns the
 * lock abstraction, so the key lives with it. A SECOND copy of the string was
 * the alternative and was rejected: two definitions of a lock key serialize
 * nothing the day they drift.
 *
 * @module libs/core/src/sync/application/services
 */

/**
 * Lock key for dispatching one order (#1917).
 *
 * Keyed per ORDER, not per (order, connection): the operator intent being
 * serialized is "ship this order", and two operators picking different carrier
 * connections for the same order is exactly as wrong as picking the same one.
 */
export function shipmentDispatchLockKey(orderId: string): string {
  return `shipment:dispatch:${orderId}`;
}
