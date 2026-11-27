/**
 * Order refund wire types (#3541)
 *
 * `POST` / `GET /orders/:internalOrderId/refunds`. OpenLinker moves no money:
 * a refund record is the operator CONFIRMING that they refunded the buyer.
 *
 * @module apps/web/src/features/orders/api
 */
import type { RefundReason } from '../lib/refund-reason';

export interface RecordOrderRefundRequest {
  /** Decimal string, never a number: `numeric(12,2)` on the other side. */
  amount: string;
  currency: string;
  reason: RefundReason;
  note?: string;
  /** Replay guard: the same key twice answers 409 instead of recording twice. */
  idempotencyKey?: string;
  /** Record a refund that takes the cumulative total past the order total. */
  acknowledgeAboveCeiling?: boolean;
}

export interface OrderRefundRecord {
  id: string;
  internalOrderId: string;
  amount: string;
  currency: string;
  reason: string;
  note: string | null;
  recordedAt: string;
  createdAt: string;
}
