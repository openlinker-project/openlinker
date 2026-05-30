/**
 * Order Create Lock helpers
 *
 * Lock key + TTL for serializing destination order creation per
 * (internalOrderId, destinationConnectionId). The lock (SyncLockPort) removes
 * the multi-worker race window in the adapter's check-then-act create-or-skip:
 * `sync-job.runner` locks per-job, not per-order, so a webhook job and a poll
 * job for the same order can otherwise run concurrently on two workers and both
 * create the destination order.
 *
 * @module libs/core/src/orders/application/services
 */

/**
 * Lock TTL (ms). Must comfortably exceed the worst-case `createOrder` duration
 * (PrestaShop: customer provisioning + cart + price-pin + POST /orders is
 * multi-second). The lock is single-shot (no heartbeat), so it guarantees
 * exactly-once only up to this TTL; beyond it, correctness falls back to the
 * adapter's own duplicate-key recovery (PrestaShop keeps one).
 *
 * Operator-tunable via `OL_ORDER_CREATE_LOCK_TTL_MS` (clamped to [10s, 600s]),
 * mirroring `OL_WEBHOOK_SKEW_WINDOW_MS`. Tune up for slow destinations.
 */
const DEFAULT_ORDER_CREATE_LOCK_TTL_MS = 120_000;
const MIN_ORDER_CREATE_LOCK_TTL_MS = 10_000;
const MAX_ORDER_CREATE_LOCK_TTL_MS = 600_000;

function resolveOrderCreateLockTtlMs(): number {
  const raw = process.env.OL_ORDER_CREATE_LOCK_TTL_MS;
  const parsed = raw !== undefined && raw !== '' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ORDER_CREATE_LOCK_TTL_MS;
  }
  return Math.min(MAX_ORDER_CREATE_LOCK_TTL_MS, Math.max(MIN_ORDER_CREATE_LOCK_TTL_MS, parsed));
}

export const ORDER_CREATE_LOCK_TTL_MS = resolveOrderCreateLockTtlMs();

/**
 * Build the lock key for creating one order at one destination.
 */
export function orderCreateLockKey(
  destinationConnectionId: string,
  internalOrderId: string,
): string {
  return `order:create:${destinationConnectionId}:${internalOrderId}`;
}
