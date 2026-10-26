/**
 * Live Order Issuance Facts (DEF-26)
 *
 * Reads an `OrderRecord` and its refund summary into the primitive facts the
 * `sales-documents` gate decides on. The gate lives in that leaf and may not
 * import this context, so the reading lives here, once, for every caller -
 * the worker, the fiscal registration handler and the HTTP issue routes.
 *
 * @module libs/core/src/orders/domain
 */
import type { LiveOrderIssuanceFacts } from '@openlinker/core/sales-documents';
import type { OrderRecord } from './entities/order-record.entity';
import type { RefundSummary } from './types/refund-record.types';

export function toLiveOrderIssuanceFacts(
  record: OrderRecord,
  refunds?: RefundSummary | null,
): LiveOrderIssuanceFacts {
  const refundedTotal = refunds ? Number(refunds.totalAmount) : undefined;
  return {
    cancelled: record.isCancelled,
    ...(record.status !== undefined ? { status: record.status } : {}),
    ...(refundedTotal !== undefined && Number.isFinite(refundedTotal) ? { refundedTotal } : {}),
    ...(record.totalAmount !== null ? { orderTotal: record.totalAmount } : {}),
  };
}
