/**
 * Refund Record Types
 *
 * Categorized reason vocabulary, create-input shape, and per-order summary
 * projection for capturing a return/refund/withdrawal against an order (#2036).
 *
 * @module domain/types
 */

/**
 * Categorized refund reasons. Kept small and PL-withdrawal-aware so a future
 * "returns by reason" analytics breakdown doesn't need a separate
 * categorization pass. `note` on the entity covers free-text operator
 * context that doesn't fit the union.
 */
export const RefundReasonValues = [
  'withdrawal',
  'defective',
  'not_as_described',
  'wrong_item',
  'other',
] as const;

export type RefundReason = (typeof RefundReasonValues)[number];

/**
 * WHO actually moved the buyer's money (#2371, ADR-056).
 *
 * The honesty device, and the exact spelling ADR-056 names: OpenLinker ships no
 * refund WRITE, so on every path reachable today a human refunded out of band
 * and OL is recording that fact — it never claims to have moved the money
 * itself. `refund_executor` becomes reachable the day an adapter implements the
 * `RefundExecutor` capability, and not before.
 *
 * Deliberately parallel to `RestockedByValues` in the returns act ledger
 * (#2370): same question, asked of money instead of goods.
 */
export const RefundExecutedByValues = ['operator_out_of_band', 'refund_executor'] as const;

export type RefundExecutedBy = (typeof RefundExecutedByValues)[number];

export interface CreateRefundRecordInput {
  internalOrderId: string;
  /** Decimal string (e.g. "19.99") — see `CodToCollect` for the same convention. */
  amount: string;
  /** ISO 4217, 3-letter. Enforced to match every prior refund on the same order — see `OrderRefundService.recordRefund`. */
  currency: string;
  reason: RefundReason;
  note: string | null;
  recordedAt: Date;
  /**
   * Optional caller-supplied dedup key, scoped per `internalOrderId` (mirrors
   * `InvoiceRecord`'s `(connectionId, idempotencyKey)` dedup guard). A retried
   * write with the same key against the same order is rejected via
   * `DuplicateRefundRecordException` rather than silently inserting a second
   * row and inflating `RefundSummary.totalAmount`. `null`/omitted disables the
   * guard for that write (e.g. a caller with no natural retry key).
   */
  idempotencyKey?: string | null;
  /**
   * The return this refund settles, when it settles one (#2371).
   *
   * The `refund_records.returnId` column has existed since #2327 as
   * persistence-only — a deliberate stub awaiting its first writer. This is
   * that writer's field. Optional because a refund legitimately exists without
   * a return (goodwill, price correction), which is precisely why `RefundRecord`
   * was LINKED to returns rather than extended by them (ADR-060).
   */
  returnId?: string | null;
  /**
   * Who moved the money. Defaults to `operator_out_of_band` — the only value
   * any shipped path can produce, and the truthful one.
   */
  executedBy?: RefundExecutedBy;
}

/**
 * Aggregate refund summary for one order — the read shape consumed by
 * `getRefundSummariesForOrders` (batch) and any future analytics projection.
 */
export interface RefundSummary {
  count: number;
  /** Decimal string. Safe to sum as a single currency — `OrderRefundService.recordRefund` rejects a refund whose currency doesn't match the order's prior refunds. */
  totalAmount: string;
  currency: string;
}
