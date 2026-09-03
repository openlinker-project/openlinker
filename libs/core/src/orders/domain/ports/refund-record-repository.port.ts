/**
 * Refund Record Repository Port
 *
 * Persistence contract for refund records (#2036). Kept intra-context —
 * consumed only by `OrderRefundService` inside `orders` — so it is not
 * re-exported from the top-level `@openlinker/core/orders` barrel (no
 * identified cross-context consumer today; add the export if one appears).
 *
 * @module domain/ports
 */
import type { RefundRecord } from '../entities/refund-record.entity';
import type { CreateRefundRecordInput, RefundSummary } from '../types/refund-record.types';

export interface RefundRecordRepositoryPort {
  /**
   * Persist a new refund record. No uniqueness constraint on the refund's
   * *content* — multiple genuine partial refunds against one order are valid
   * and expected. When `input.idempotencyKey` is set, a retried call with the
   * same key against the same order throws `DuplicateRefundRecordException`
   * (#2036) instead of inserting a second row.
   */
  create(input: CreateRefundRecordInput): Promise<RefundRecord>;

  /**
   * All refund records for one order, most recent first. Returns `[]` for an
   * order with no refunds — never throws for "not found".
   */
  findByOrderId(internalOrderId: string): Promise<RefundRecord[]>;

  /**
   * All refund records linked to one RETURN, most recent first (#2382).
   *
   * **Not substitutable by {@link findByOrderId}**, for two reasons that both
   * put wrong money in front of an operator. An ORPHAN return carries no
   * `internalOrderId` at all, so a by-order read renders its refund panel
   * permanently empty — on exactly the returns most likely to need manual
   * handling. And an order carrying two returns would show each return's panel
   * the other's refunds, which is the same false-attribution shape #2381
   * removed from the restock notice.
   *
   * Rides `IDX_refund_records_return_id`, the partial index
   * (`WHERE "returnId" IS NOT NULL`) that has existed since the column was added
   * and had no consumer until now.
   */
  findByReturnId(returnId: string): Promise<RefundRecord[]>;

  /**
   * Batch aggregate read: count + total amount per order, for the given id
   * set. A single query scoped to the given ids — the real batch a
   * cross-cutting analytics read needs, as opposed to a de-duplicated
   * `Promise.all` fan-out over {@link findByOrderId}. Ids with no refund rows
   * are silently omitted from the result map (never throws, never pads with
   * a zero entry); callers join back via a `Map` keyed by `internalOrderId`.
   * Returns an empty `Map` immediately for an empty `internalOrderIds` input,
   * without issuing a query.
   */
  summarizeByOrderIds(internalOrderIds: string[]): Promise<Map<string, RefundSummary>>;
}
