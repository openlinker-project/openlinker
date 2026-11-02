/**
 * Order Refund Lock helpers (#3289)
 *
 * Serializes `OrderRefundService.recordRefund` per ORDER. The refund ceiling is
 * a READ (`summarizeByOrderIds`) followed by a write, so two concurrent records
 * on one order would both read the old sum and both pass - the #2047 invoice
 * issue lock's reasoning, applied to refunds.
 *
 * @module libs/core/src/orders/application/services
 */

/**
 * Default lock TTL (ms), sized for `recordRefund`'s own span: ceiling read ->
 * `create`, a few DB round-trips. The lock is single-shot with no heartbeat,
 * so a caller that holds it across anything slower - the returns confirm flow
 * holds it across the refund executor's outbound call - must pass a TTL that
 * covers that call (`RunUnderOrderRefundLockOptions.lockTtlMs`). Otherwise the
 * lock can expire mid-flight and a second refund of the same order reads a sum
 * that does not yet include the first.
 */
export const ORDER_REFUND_LOCK_TTL_MS = 30_000;

/**
 * The TTL actually requested: never shorter than the default, so a caller can
 * only lengthen the lock, never shorten it below what `recordRefund` needs.
 */
export function resolveOrderRefundLockTtlMs(requestedTtlMs?: number): number {
  if (requestedTtlMs === undefined || !Number.isFinite(requestedTtlMs)) {
    return ORDER_REFUND_LOCK_TTL_MS;
  }
  return Math.max(ORDER_REFUND_LOCK_TTL_MS, requestedTtlMs);
}

/**
 * How long a refund waits to take the lock (ms) before answering "unavailable".
 * Without a bound, a lock store that stops answering (Redis paused or
 * partitioned) keeps the request open with no reply, and the queued lock
 * command then runs when the store returns - recording a refund the operator
 * already gave up on and may record again (R-16).
 */
export const ORDER_REFUND_LOCK_ACQUIRE_TIMEOUT_MS = 5_000;

export function orderRefundLockKey(internalOrderId: string): string {
  return `order:refund:${internalOrderId}`;
}
