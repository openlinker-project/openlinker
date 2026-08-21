/**
 * orderAnalyticsProjection Unit Tests
 *
 * @module libs/core/src/orders/domain
 */
import { deriveOrderAnalyticsScalars, deriveOrderLineItems } from './order-analytics-projection';
import type { Order } from './types/order.types';

describe('orderAnalyticsProjection', () => {
  const baseOrder = (): Order => ({
    id: 'ol_order_1',
    orderNumber: 'ORD-001',
    status: 'pending',
    items: [
      { id: 'item-1', productId: 'ol_product_1', variantId: 'ol_variant_1', quantity: 2, price: 10 },
      { id: 'item-2', productId: 'ol_product_2', quantity: 1, price: 5 },
    ],
    totals: {
      subtotal: 25,
      tax: 5,
      shipping: 2,
      total: 32,
      currency: 'PLN',
      taxTreatment: 'inclusive',
    },
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
  });

  describe('deriveOrderAnalyticsScalars', () => {
    it('derives all 4 scalars when the order carries them', () => {
      const order = { ...baseOrder(), placedAt: new Date('2026-08-01T09:00:00.000Z') };

      expect(deriveOrderAnalyticsScalars(order)).toEqual({
        placedAt: new Date('2026-08-01T09:00:00.000Z'),
        currency: 'PLN',
        taxTreatment: 'inclusive',
        totalAmount: 32,
      });
    });

    it('returns placedAt: null when the order does not carry one', () => {
      const order = baseOrder();
      expect(order.placedAt).toBeUndefined();

      expect(deriveOrderAnalyticsScalars(order).placedAt).toBeNull();
    });

    it('returns taxTreatment: null when the source did not assert it (#1985 [G])', () => {
      const order = baseOrder();
      delete order.totals.taxTreatment;

      expect(deriveOrderAnalyticsScalars(order).taxTreatment).toBeNull();
    });

    it('never throws on a malformed totals.total', () => {
      const order = baseOrder();
      // @ts-expect-error — simulating a malformed snapshot-derived value at runtime
      order.totals.total = 'not-a-number';

      expect(() => deriveOrderAnalyticsScalars(order)).not.toThrow();
      expect(deriveOrderAnalyticsScalars(order).totalAmount).toBeNull();
    });
  });

  describe('deriveOrderLineItems', () => {
    it('returns one draft per item, with lineNumber = array index', () => {
      const order = baseOrder();

      const drafts = deriveOrderLineItems(order, 'conn-123');

      expect(drafts).toHaveLength(2);
      expect(drafts[0]).toEqual({
        lineNumber: 0,
        productId: 'ol_product_1',
        variantId: 'ol_variant_1',
        quantity: 2,
        unitPrice: 10,
        sourceConnectionId: 'conn-123',
        placedAt: null,
      });
      expect(drafts[1]).toMatchObject({
        lineNumber: 1,
        productId: 'ol_product_2',
        variantId: null,
        quantity: 1,
        unitPrice: 5,
      });
    });

    it('returns [] for an order with no items, never throws', () => {
      const order = { ...baseOrder(), items: [] };

      expect(() => deriveOrderLineItems(order, 'conn-123')).not.toThrow();
      expect(deriveOrderLineItems(order, 'conn-123')).toEqual([]);
    });

    it('denormalizes the order-level placedAt onto every line', () => {
      const order = { ...baseOrder(), placedAt: new Date('2026-08-01T09:00:00.000Z') };

      const drafts = deriveOrderLineItems(order, 'conn-123');

      expect(drafts.every((d) => d.placedAt?.getTime() === order.placedAt?.getTime())).toBe(true);
    });
  });
});
