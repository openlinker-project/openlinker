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
 * Lock TTL (ms). It only needs to cover ceiling read -> `create`, a few DB
 * round-trips; the lock is single-shot with no heartbeat, since once the row
 * exists a peer's own read sees it.
 */
export const ORDER_REFUND_LOCK_TTL_MS = 30_000;

export function orderRefundLockKey(internalOrderId: string): string {
  return `order:refund:${internalOrderId}`;
}
