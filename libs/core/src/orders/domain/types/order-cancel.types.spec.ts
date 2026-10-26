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
  OrderMutationChangeKindValues,
  cancelCorrectionTargetRef,
  cancelRequestTargetRef,
  isOrderMutationChangeKind,
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
  it('should count only order.* kinds as order-mutating, never return.* kinds', () => {
    expect(OrderMutationChangeKindValues).toEqual(['order.cancel_request', 'order.cancel_correction']);
    expect(isOrderMutationChangeKind('return.decline')).toBe(false);
    expect(isOrderMutationChangeKind('order.cancel_request')).toBe(true);
  });

  it('should keep every mutation kind a member of the full vocabulary', () => {
    for (const kind of OrderMutationChangeKindValues) {
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
