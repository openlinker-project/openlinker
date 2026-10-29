/**
 * Order Refund Service Interface
 *
 * Application-layer contract for capturing and reading refund records
 * (#2036). `getRefundSummariesForOrders` is the in-process batch read seam
 * future analytics code (#1987/#1988/#1990) consumes without reaching into
 * `orders` internals — mirrors `IInvoiceService.getLatestInvoicesForOrders`.
 *
 * @module application/interfaces
 */
import type { RefundRecord } from '../../domain/entities/refund-record.entity';
import type { RefundCeilingVerdict } from '../../domain/types/refund-ceiling.types';
import type { CreateRefundRecordInput, RefundSummary } from '../../domain/types/refund-record.types';

export interface RecordRefundOptions {
  /**
   * The caller already holds the per-order refund lock (via
   * {@link IOrderRefundService.runUnderOrderRefundLock}), so `recordRefund` must
   * not acquire it again - the lock is not re-entrant.
   */
  orderLockHeld?: boolean;
  /**
   * Receives the ceiling verdict the write was decided on, including an
   * `unknown` one that let the refund through unchecked (#3289). A callback
   * rather than a wider return type so every existing caller of `recordRefund`
   * keeps its `RefundRecord`.
   */
  onCeilingVerdict?: (verdict: RefundCeilingVerdict) => void;
}

export interface IOrderRefundService {
  recordRefund(input: CreateRefundRecordInput, options?: RecordRefundOptions): Promise<RefundRecord>;

  /**
   * Run `work` while holding the per-order refund lock (#3289, B-1). For callers
   * whose ceiling check and its matching record write are separated by money
   * moving (the returns confirm flow): holding the lock across both is what
   * makes "two concurrent refunds of one order cannot both pass" true.
   * Throws `RefundRecordContendedException` when the lock is taken.
   */
  runUnderOrderRefundLock<T>(internalOrderId: string, work: () => Promise<T>): Promise<T>;
  getRefundsForOrder(internalOrderId: string): Promise<RefundRecord[]>;

  /**
   * Refunds linked to one RETURN (#2382) — the read behind the return detail's
   * refund panel.
   *
   * A separate read rather than a filter over {@link getRefundsForOrder},
   * because an orphan return has no order id to filter by and an order with two
   * returns would cross-attribute. See the repository port for the full
   * argument.
   */
  getRefundsForReturn(returnId: string): Promise<RefundRecord[]>;
  getRefundSummariesForOrders(internalOrderIds: string[]): Promise<Map<string, RefundSummary>>;
}
