import { describe, expect, it } from 'vitest';
import { parseOrderSnapshot } from './order-snapshot.schema';

describe('parseOrderSnapshot', () => {
  it('parses a well-formed snapshot into typed view-model data', () => {
    const snapshot = {
      id: 'ol_order_abc',
      orderNumber: '1024',
      status: 'pending',
      items: [
        {
          id: 'ol_orderitem_1',
          productId: 'ol_product_xyz',
          quantity: 2,
          price: 19.99,
          sku: 'SKU-1',
          name: 'Widget',
        },
      ],
      totals: {
        subtotal: 39.98,
        tax: 0,
        shipping: 5,
        total: 44.98,
        currency: 'PLN',
      },
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Warszawa',
        postalCode: '00-001',
        country: 'PL',
      },
    };

    const parsed = parseOrderSnapshot(snapshot);

    expect(parsed).not.toBeNull();
    expect(parsed?.orderNumber).toBe('1024');
    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0].name).toBe('Widget');
    expect(parsed?.totals?.total).toBe(44.98);
    expect(parsed?.shippingAddress?.city).toBe('Warszawa');
  });

  it('returns null when the snapshot is missing required fields', () => {
    const garbage = { orderNumber: 'only-this', somethingElse: true };
    expect(parseOrderSnapshot(garbage)).toBeNull();
  });

  it('defaults items to an empty array when omitted', () => {
    const snapshot = { id: 'ol_order_abc' };
    const parsed = parseOrderSnapshot(snapshot);
    expect(parsed?.items).toEqual([]);
  });

  it('accepts a minimal snapshot with no optional fields', () => {
    const snapshot = { id: 'ol_order_abc' };
    const parsed = parseOrderSnapshot(snapshot);

    expect(parsed).not.toBeNull();
    expect(parsed?.orderNumber).toBeUndefined();
    expect(parsed?.totals).toBeUndefined();
    expect(parsed?.shippingAddress).toBeUndefined();
  });
});
