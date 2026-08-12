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

export interface CreateRefundRecordInput {
  internalOrderId: string;
  /** Decimal string (e.g. "19.99") — see `CodToCollect` for the same convention. */
  amount: string;
  /** ISO 4217, 3-letter. */
  currency: string;
  reason: RefundReason;
  note: string | null;
  recordedAt: Date;
}

/**
 * Aggregate refund summary for one order — the read shape consumed by
 * `getRefundSummariesForOrders` (batch) and any future analytics projection.
 */
export interface RefundSummary {
  count: number;
  /** Decimal string; sums assume every refund for the order shares one currency. */
  totalAmount: string;
  currency: string;
}
