/**
 * order-row view-model helper tests (#1713).
 */
import { describe, expect, it } from 'vitest';
import type { ParsedOrderItem } from '../api/order-snapshot.schema';
import { itemsSummary, paymentBadge } from './order-row';

function item(id: string, name?: string): ParsedOrderItem {
  return { id, quantity: 1, price: 10, name };
}

describe('itemsSummary', () => {
  it('returns null when there are no named items', () => {
    expect(itemsSummary([])).toBeNull();
    expect(itemsSummary([item('i1', undefined)])).toBeNull();
  });

  it('returns the single name with moreCount 0 for a one-item order', () => {
    expect(itemsSummary([item('i1', 'Widget')])).toEqual({ firstName: 'Widget', moreCount: 0 });
  });

  it('returns the first name and the count of the rest for a multi-item order', () => {
    const summary = itemsSummary([item('i1', 'Widget'), item('i2', 'Gadget'), item('i3', 'Gizmo')]);
    expect(summary).toEqual({ firstName: 'Widget', moreCount: 2 });
  });

  it('ignores unnamed items when counting the remainder', () => {
    const summary = itemsSummary([item('i1', 'Widget'), item('i2', undefined)]);
    expect(summary).toEqual({ firstName: 'Widget', moreCount: 0 });
  });
});

describe('paymentBadge', () => {
  it('returns null when the status is absent', () => {
    expect(paymentBadge(undefined)).toBeNull();
  });

  it('maps each payment status to a distinct label + tone', () => {
    expect(paymentBadge('paid')).toEqual({ label: 'Paid', tone: 'success' });
    expect(paymentBadge('cod')).toEqual({ label: 'COD', tone: 'review' });
    expect(paymentBadge('awaiting')).toEqual({ label: 'Awaiting', tone: 'warning' });
    expect(paymentBadge('refunded')).toEqual({ label: 'Refunded', tone: 'neutral' });
  });
});
