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
import type { CreateRefundRecordInput, RefundSummary } from '../../domain/types/refund-record.types';

export interface IOrderRefundService {
  recordRefund(input: CreateRefundRecordInput): Promise<RefundRecord>;
  getRefundsForOrder(internalOrderId: string): Promise<RefundRecord[]>;
  getRefundSummariesForOrders(internalOrderIds: string[]): Promise<Map<string, RefundSummary>>;
}
