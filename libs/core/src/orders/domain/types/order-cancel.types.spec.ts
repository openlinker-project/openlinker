/**
 * Order Cancel Types Tests (#3540)
 *
 * @module libs/core/src/orders/domain/types
 */
import {
  OrderCancelReasonValues,
  isOrderCancelReason,
  orderCancelReasonRequiresNote,
  orderStockRestoreDedupeKey,
} from './order-cancel.types';
import {
  OrderChangeKindValues,
  OrderAmendmentRequestKindValues,
  OrderCorrectionChangeKindValues,
  isOrderCorrectionChangeKind,
  isOrderOperatorEditKind,
  discountEditTargetRef,
  discountRefundTargetRef,
  discountCorrectionTargetRef,
  cancelCorrectionTargetRef,
  cancelRequestTargetRef,
  isOrderAmendmentRequestKind,
} from './order-change.types';

describe('order cancel vocabulary (#3540)', () => {
  it('should hold exactly the five closed reasons', () => {
    expect(OrderCancelReasonValues).toEqual(['buyer-request', 'out-of-stock', 'fraud', 'duplicate', 'other']);
  });

  it('should recognise members and refuse everything else without defaulting', () => {
    expect(isOrderCancelReason('fraud')).toBe(true);
    expect(isOrderCancelReason('FRAUD')).toBe(false);
    expect(isOrderCancelReason(undefined)).toBe(false);
  });

  it('should require a note only for other', () => {
    expect(orderCancelReasonRequiresNote('other')).toBe(true);
    expect(OrderCancelReasonValues.filter((r) => orderCancelReasonRequiresNote(r))).toEqual(['other']);
  });

  it('should spell the stock-restore dedupe key exactly as ingestion always has', () => {
    expect(orderStockRestoreDedupeKey('conn-1', 'ol_order_9')).toBe(
      'marketplace:conn-1:stockRestore:ol_order_9'
    );
  });
});

describe('order change kinds (#3540)', () => {
  it('should count only an amendment REQUEST as amending - not return.* kinds and not correction proposals', () => {
    expect(OrderAmendmentRequestKindValues).toEqual(['order.cancel_request']);
    expect(isOrderAmendmentRequestKind('order.cancel_correction')).toBe(false);
    expect(isOrderCorrectionChangeKind('order.cancel_correction')).toBe(true);
    expect(isOrderCorrectionChangeKind('order.cancel_request')).toBe(false);
    expect(isOrderAmendmentRequestKind('return.decline')).toBe(false);
    expect(isOrderAmendmentRequestKind('order.cancel_request')).toBe(true);
  });

  it('should NOT count the discount kinds as amending - they are an edit and two proposals, not a request to a channel (#3543)', () => {
    for (const kind of ['order.discount_change', 'order.discount_refund', 'order.discount_correction']) {
      expect(isOrderAmendmentRequestKind(kind)).toBe(false);
      expect(OrderChangeKindValues).toContain(kind);
    }
    expect(isOrderOperatorEditKind('order.discount_change')).toBe(true);
    expect(isOrderCorrectionChangeKind('order.discount_refund')).toBe(true);
    expect(isOrderCorrectionChangeKind('order.discount_correction')).toBe(true);
    expect(isOrderCorrectionChangeKind('order.discount_change')).toBe(false);
  });

  it('should keep the three discount targetRef namespaces disjoint from each other and from the edit and cancel ones', () => {
    const refs = [
      discountEditTargetRef('o1'),
      discountRefundTargetRef('o1', 'chg-1'),
      discountCorrectionTargetRef('o1', 'inv-1'),
      cancelCorrectionTargetRef('o1', 'inv-1'),
    ];
    expect(refs).toEqual([
      'edit:discount:o1',
      'refund:discount:o1:chg-1',
      'correction:discount:o1:inv-1',
      'correction:cancel:o1:inv-1',
    ]);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('should keep every mutation kind a member of the full vocabulary', () => {
    for (const kind of [...OrderAmendmentRequestKindValues, ...OrderCorrectionChangeKindValues]) {
      expect(OrderChangeKindValues).toContain(kind);
    }
  });

  it('should keep the two new targetRef namespaces disjoint from each other and from a bare id', () => {
    const request = cancelRequestTargetRef('ol_order_1');
    const correction = cancelCorrectionTargetRef('ol_order_1', 'inv-1');

    expect(request).toBe('cancel:ol_order_1');
    expect(correction).toBe('correction:cancel:ol_order_1:inv-1');
    expect(request).not.toBe(correction);
    expect(request.startsWith('cancel:')).toBe(true);
  });
});
