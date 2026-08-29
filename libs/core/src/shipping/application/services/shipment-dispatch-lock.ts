/**
 * Shipment Dispatch Lock helpers
 *
 * Lock key + TTL for serializing label dispatch per order (#1917). The lock
 * (SyncLockPort) removes the race window in `ShipmentDispatchService`'s
 * check-then-act: `findActiveByOrderId` is a plain read, so two dispatches for
 * the same order can both pass it, and the loser then resets the winner's
 * just-created draft row (`UQ_shipments_branch_one_per_order_conn` forbids a
 * second waybill-less row, so it reuses rather than inserts). Both requests
 * then call `generateLabel` with the same shipment id and the carrier mints two
 * paid labels under one reference.
 *
 * Keyed per ORDER, not per (order, connection): the operator intent being
 * serialized is "ship this order", and two operators picking different carrier
 * connections for the same order is exactly as wrong as picking the same one.
 *
 * @module libs/core/src/shipping/application/services
 */

/**
 * Lock TTL (ms). Must comfortably exceed the worst-case `generateLabel`
 * round-trip (carrier label generation is multi-second; the FE's own submit
 * button advertises ~30s). The lock is single-shot (no heartbeat), so it
 * guarantees serialization only up to this TTL; beyond it, correctness falls
 * back to the `ShipmentReferenceReconciler` find-by-reference adoption on the
 * retry path.
 *
 * Operator-tunable via `OL_SHIPMENT_DISPATCH_LOCK_TTL_MS` (clamped to
 * [10s, 600s]), mirroring `ORDER_CREATE_LOCK_TTL_MS`.
 *
 * Resolved ONCE at module load, so it is fixed for the process lifetime and
 * cannot be varied per-test by mutating `process.env` after import (a spec that
 * needs a different value re-imports the module in isolation). That is the
 * `ORDER_CREATE_LOCK_TTL_MS` precedent, kept deliberately for consistency —
 * stated here so it is a known property rather than a surprise.
 */
const DEFAULT_SHIPMENT_DISPATCH_LOCK_TTL_MS = 120_000;
const MIN_SHIPMENT_DISPATCH_LOCK_TTL_MS = 10_000;
const MAX_SHIPMENT_DISPATCH_LOCK_TTL_MS = 600_000;

function resolveShipmentDispatchLockTtlMs(): number {
  const raw = process.env.OL_SHIPMENT_DISPATCH_LOCK_TTL_MS;
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SHIPMENT_DISPATCH_LOCK_TTL_MS;
  }
  return Math.min(
    MAX_SHIPMENT_DISPATCH_LOCK_TTL_MS,
    Math.max(MIN_SHIPMENT_DISPATCH_LOCK_TTL_MS, parsed),
  );
}

export const SHIPMENT_DISPATCH_LOCK_TTL_MS = resolveShipmentDispatchLockTtlMs();

/**
 * Build the lock key for dispatching one order.
 *
 * The definition MOVED to `@openlinker/core/sync` and is re-exported here so
 * every existing caller is unchanged. It moved because `OrderHoldService`
 * (`orders`) needs the identical key to detect an in-flight dispatch, and
 * `orders` may not value-import `shipping` — see that file's docblock.
 */
export { shipmentDispatchLockKey } from '@openlinker/core/sync';
