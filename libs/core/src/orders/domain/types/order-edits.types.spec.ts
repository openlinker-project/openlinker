/**
 * Order Edits Overlay Tests (#3542)
 *
 * @module libs/core/src/orders/domain/types
 */
import {
  applyOrderEditsToOrder,
  applyOrderEditsToSnapshot,
  describeEditedTotals,
  findUnmatchedLineEdits,
  readOrderEdits,
  type OrderEdits,
} from './order-edits.types';
import type { Order } from './order.types';

const stamp = { changeId: 'chg-1', editedAt: '2026-10-26T10:00:00.000Z', editedBy: 'user-1' };

const channelSnapshot = (): Record<string, unknown> => ({
  id: 'ol_order_1',
  status: 'processing',
  items: [
    { id: 'l1', productId: 'p1', quantity: 3, price: 10, sku: 'A' },
    { id: 'l2', productId: 'p2', quantity: 1, price: 25.5, unitPriceGross: 30, sku: 'B' },
  ],
  totals: { subtotal: 55.5, tax: 10, shipping: 12, total: 97.5, currency: 'PLN', taxTreatment: 'inclusive' },
  shippingAddress: { address1: 'Old 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
  shipping: { methodId: 'courier', methodName: 'Courier' },
  pickupPoint: { id: 'LOCKER1' },
  codToCollect: { amount: '97.50', currency: 'PLN' },
});

describe('readOrderEdits', () => {
  it('should read an absent or foreign value as no edits', () => {
    expect(readOrderEdits(null)).toBeNull();
    expect(readOrderEdits({ v: 2 })).toBeNull();
    expect(readOrderEdits('x')).toBeNull();
    expect(readOrderEdits({ v: 1, rev: 3 })).toBeNull();
  });

  it('should keep a well formed section and drop a corrupt one without losing the rest', () => {
    const edits = readOrderEdits({
      v: 1,
      rev: 2,
      lines: { l1: { ...stamp, quantity: 1 }, bad: { quantity: 'x' } },
      address: { address1: 'x' },
    });
    expect(edits?.lines).toEqual({ l1: { ...stamp, quantity: 1 } });
    expect(edits?.address).toBeUndefined();
    expect(edits?.rev).toBe(2);
  });

  it('should preserve a reserved discount section verbatim', () => {
    expect(readOrderEdits({ v: 1, rev: 1, discount: { amount: '5.00' } })?.discount).toEqual({
      amount: '5.00',
    });
  });
});

describe('applyOrderEditsToSnapshot', () => {
  it('should return the very same object when there are no edits', () => {
    const snapshot = channelSnapshot();
    expect(applyOrderEditsToSnapshot(snapshot, null)).toBe(snapshot);
  });

  it('should replace the shipping address and delivery method and leave the channel original untouched', () => {
    const snapshot = channelSnapshot();
    const edits: OrderEdits = {
      v: 1,
      rev: 2,
      address: {
        ...stamp,
        hash: 'h',
        shipping: { address1: 'New 2', city: 'Krakow', postalCode: '30-001', country: 'PL' },
      },
      deliveryMethod: { ...stamp, methodId: 'locker', methodName: 'Locker', pickupPoint: null },
    };
    const merged = applyOrderEditsToSnapshot(snapshot, edits);
    expect((merged.shippingAddress as { city: string }).city).toBe('Krakow');
    expect(merged.shipping).toEqual({ methodId: 'locker', methodName: 'Locker' });
    expect(merged.pickupPoint).toBeUndefined();
    expect((snapshot.shippingAddress as { city: string }).city).toBe('Warsaw');
    expect(snapshot.pickupPoint).toEqual({ id: 'LOCKER1' });
  });

  it('should lower a line, drop a line at zero and restate total, subtotal and COD so lines still sum to the total', () => {
    const edits: OrderEdits = {
      v: 1,
      rev: 1,
      lines: { l1: { ...stamp, quantity: 1 }, l2: { ...stamp, quantity: 0 } },
    };
    const merged = applyOrderEditsToSnapshot(channelSnapshot(), edits);
    expect(merged.items).toEqual([{ id: 'l1', productId: 'p1', quantity: 1, price: 10, sku: 'A' }]);
    // 2 x 10 + 1 x 30 (gross) removed from 97.50
    expect((merged.totals as { total: number }).total).toBe(47.5);
    // 2 x 10 + 1 x 25.5 removed from 55.50
    expect((merged.totals as { subtotal: number }).subtotal).toBe(10);
    expect((merged.totals as { tax: number }).tax).toBe(10);
    expect(merged.codToCollect).toEqual({ amount: '47.50', currency: 'PLN' });
  });

  it('should never raise a line: the effective quantity is min(overlay, channel)', () => {
    const merged = applyOrderEditsToSnapshot(channelSnapshot(), {
      v: 1,
      rev: 1,
      lines: { l1: { ...stamp, quantity: 9 } },
    });
    expect((merged.items as Array<{ quantity: number }>)[0].quantity).toBe(3);
    expect((merged.totals as { total: number }).total).toBe(97.5);
  });

  it('should drop the COD amount once nothing is left to collect', () => {
    // The COD amount here equals the lines' gross value (3 x 10 + 1 x 30), so
    // removing every line leaves nothing to collect.
    const merged = applyOrderEditsToSnapshot(
      { ...channelSnapshot(), codToCollect: { amount: '60.00', currency: 'PLN' } },
      {
        v: 1,
        rev: 1,
        lines: { l1: { ...stamp, quantity: 0 }, l2: { ...stamp, quantity: 0 } },
      }
    );
    expect(merged.codToCollect).toBeUndefined();
  });
});

describe('applyOrderEditsToOrder', () => {
  it('should apply the same merge to a live order', () => {
    const order = {
      id: 'o',
      status: 'processing',
      items: [{ id: 'l1', productId: 'p', quantity: 2, price: 10 }],
      totals: { subtotal: 20, tax: 0, shipping: 0, total: 20, currency: 'PLN' },
    } as Order;
    const merged = applyOrderEditsToOrder(order, {
      v: 1,
      rev: 1,
      lines: { l1: { ...stamp, quantity: 1 } },
    });
    expect(merged.items[0].quantity).toBe(1);
    expect(merged.totals.total).toBe(10);
    expect(order.items[0].quantity).toBe(2);
    expect(applyOrderEditsToOrder(order, null)).toBe(order);
  });
});

describe('describeEditedTotals', () => {
  it('should report both figures, the difference, and that tax is not restated', () => {
    const view = describeEditedTotals(channelSnapshot(), {
      v: 1,
      rev: 1,
      lines: { l1: { ...stamp, quantity: 2 } },
    });
    expect(view).toEqual({
      currency: 'PLN',
      channelTotal: 97.5,
      total: 87.5,
      difference: 10,
      taxRestated: false,
    });
  });
});

describe('net-priced line without a gross price (B-38)', () => {
  const wooLike = (): Record<string, unknown> => ({
    id: 'ol_order_2',
    items: [{ id: 'l1', productId: 'p1', quantity: 3, price: 10 }],
    totals: { subtotal: 30, tax: 6.9, shipping: 0, total: 36.9, currency: 'PLN', taxTreatment: 'exclusive', totalTaxTreatment: 'inclusive' },
  });

  it('should not subtract the NET price from the GROSS total', () => {
    const merged = applyOrderEditsToSnapshot(wooLike(), {
      v: 1,
      rev: 1,
      lines: { l1: { ...stamp, quantity: 2 } },
    });

    const totals = merged.totals as { total: number; subtotal: number };
    expect(totals.total).toBe(36.9);
    expect(totals.subtotal).toBe(20);
  });
});

describe('findUnmatchedLineEdits (line ids change)', () => {
  it('should report an overlay entry the channel no longer has and keep applying the rest', () => {
    const edits: OrderEdits = {
      v: 1,
      rev: 1,
      lines: { l1: { ...stamp, quantity: 1 }, renamed: { ...stamp, quantity: 2 } },
    };

    expect(findUnmatchedLineEdits(channelSnapshot(), edits)).toEqual([
      { orderLineId: 'renamed', editedQuantity: 2, editedAt: stamp.editedAt },
    ]);
    const merged = applyOrderEditsToSnapshot(channelSnapshot(), edits);
    expect((merged.items as Array<{ id: string; quantity: number }>).find((i) => i.id === 'l1')?.quantity).toBe(1);
  });

  it('should leave a line the channel added after the edit unedited and report nothing', () => {
    const snapshot = channelSnapshot();
    (snapshot.items as unknown[]).push({ id: 'l3', productId: 'p3', quantity: 2, price: 5 });
    const edits: OrderEdits = { v: 1, rev: 1, lines: { l1: { ...stamp, quantity: 1 } } };

    expect(findUnmatchedLineEdits(snapshot, edits)).toEqual([]);
    const merged = applyOrderEditsToSnapshot(snapshot, edits);
    expect((merged.items as Array<{ id: string; quantity: number }>).find((i) => i.id === 'l3')?.quantity).toBe(2);
  });
});
