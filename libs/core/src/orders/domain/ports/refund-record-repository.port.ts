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
   * Persist a new refund record. No uniqueness constraint — multiple genuine
   * partial refunds against one order are valid and expected.
   */
  create(input: CreateRefundRecordInput): Promise<RefundRecord>;

  /**
   * All refund records for one order, most recent first. Returns `[]` for an
   * order with no refunds — never throws for "not found".
   */
  findByOrderId(internalOrderId: string): Promise<RefundRecord[]>;

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
