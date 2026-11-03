/**
 * Live Order Issuance Read (DEF-26)
 *
 * The read both document handlers (`invoicing.issue`, `fiscalization.register`)
 * make immediately before issuing: the order's current record and recorded
 * refunds, decided by the shared `decideLiveOrderIssuance` rule. A missing
 * record degrades to `allow`, as #1596 always did, for sources that report no
 * status. A failed read throws, so the caller's retry path keeps it fail-closed.
 *
 * @module apps/worker/src/sync/handlers
 */
import {
  toLiveOrderIssuanceFacts,
  type IOrderRecordService,
  type IOrderRefundService,
} from '@openlinker/core/orders';
import { decideLiveOrderIssuance, type LiveOrderIssuanceDecision } from '@openlinker/core/sales-documents';

export async function readLiveOrderIssuanceDecision(
  orderRecords: IOrderRecordService,
  orderRefunds: IOrderRefundService,
  orderId: string,
): Promise<LiveOrderIssuanceDecision> {
  const record = await orderRecords.getOrderRecord(orderId);
  if (!record) {
    return { kind: 'allow' };
  }
  const refunds = (await orderRefunds.getRefundSummariesForOrders([orderId])).get(orderId);
  return decideLiveOrderIssuance(toLiveOrderIssuanceFacts(record, refunds));
}
