import { describe, expect, it } from 'vitest';
import { parseOrderSnapshot } from './order-snapshot.schema';

describe('parseOrderSnapshot', () => {
  it('parses a well-formed snapshot with empty warnings', () => {
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

    expect(parsed.orderNumber).toBe('1024');
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.name).toBe('Widget');
    expect(parsed.totals?.total).toBe(44.98);
    expect(parsed.shippingAddress?.city).toBe('Warszawa');
    expect(parsed.parseWarnings).toHaveLength(0);
  });

  it('surfaces totals.taxTreatment when present and leaves it undefined when absent', () => {
    const withTreatment = parseOrderSnapshot({
      totals: { subtotal: 10, tax: 2.3, shipping: 0, total: 12.3, currency: 'PLN', taxTreatment: 'inclusive' },
    });
    expect(withTreatment.totals?.taxTreatment).toBe('inclusive');
    expect(withTreatment.parseWarnings).toHaveLength(0);

    const withoutTreatment = parseOrderSnapshot({
      totals: { subtotal: 10, tax: 2.3, shipping: 0, total: 12.3, currency: 'PLN' },
    });
    expect(withoutTreatment.totals?.taxTreatment).toBeUndefined();
    expect(withoutTreatment.parseWarnings).toHaveLength(0);
  });

  it('returns a ParsedOrderSnapshot (never null) even when the top-level `id` is missing', () => {
    const parsed = parseOrderSnapshot({ orderNumber: '1024' });

    expect(parsed.id).toBeUndefined();
    expect(parsed.orderNumber).toBe('1024');
    expect(parsed.items).toEqual([]);
    expect(parsed.parseWarnings).toHaveLength(0);
  });

  it('defaults items to an empty array when the key is omitted', () => {
    const parsed = parseOrderSnapshot({ id: 'ol_order_abc' });

    expect(parsed.items).toEqual([]);
    expect(parsed.parseWarnings).toHaveLength(0);
  });

  it('keeps valid items and warns about malformed ones, without dropping the rest', () => {
    const snapshot = {
      id: 'ol_order_abc',
      items: [
        {
          id: 'ol_orderitem_1',
          productId: 'ol_product_xyz',
          quantity: 1,
          price: 10,
        },
        {
          // missing `id`, `quantity`, `price` — should be rejected
          sku: 'SKU-bad',
        },
        {
          id: 'ol_orderitem_3',
          productId: 'ol_product_abc',
          quantity: 3,
          price: 4.5,
          name: 'Third',
        },
      ],
    };

    const parsed = parseOrderSnapshot(snapshot);

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]?.id).toBe('ol_orderitem_1');
    expect(parsed.items[1]?.id).toBe('ol_orderitem_3');
    expect(parsed.parseWarnings).toHaveLength(1);
    expect(parsed.parseWarnings[0]?.field).toBe('items[1]');
  });

  it('tolerates items without productId (loosened for legacy/partial snapshots)', () => {
    const snapshot = {
      id: 'ol_order_abc',
      items: [
        {
          id: 'ol_orderitem_1',
          quantity: 1,
          price: 10,
          sku: 'SKU-A',
          name: 'No-product-id item',
        },
      ],
    };

    const parsed = parseOrderSnapshot(snapshot);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.productId).toBeUndefined();
    expect(parsed.parseWarnings).toHaveLength(0);
  });

  it('keeps items when totals are malformed, and warns about totals', () => {
    const snapshot = {
      id: 'ol_order_abc',
      items: [
        { id: 'ol_orderitem_1', quantity: 1, price: 10 },
      ],
      totals: { subtotal: 10 }, // missing tax/shipping/total/currency
    };

    const parsed = parseOrderSnapshot(snapshot);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.totals).toBeUndefined();
    expect(parsed.parseWarnings).toHaveLength(1);
    expect(parsed.parseWarnings[0]?.field).toBe('totals');
  });

  it('warns when shippingAddress is present-but-malformed and leaves billing intact', () => {
    const snapshot = {
      id: 'ol_order_abc',
      shippingAddress: { address1: 'ul. Testowa 1' }, // missing city/postalCode/country
      billingAddress: {
        address1: 'ul. Billing 2',
        city: 'Kraków',
        postalCode: '30-001',
        country: 'PL',
      },
    };

    const parsed = parseOrderSnapshot(snapshot);

    expect(parsed.shippingAddress).toBeUndefined();
    expect(parsed.billingAddress?.city).toBe('Kraków');
    expect(parsed.parseWarnings.some((w) => w.field === 'shippingAddress')).toBe(true);
    expect(parsed.parseWarnings.some((w) => w.field === 'billingAddress')).toBe(false);
  });

  it('accepts a completely empty snapshot as valid-but-empty', () => {
    const parsed = parseOrderSnapshot({});

    expect(parsed.id).toBeUndefined();
    expect(parsed.items).toEqual([]);
    expect(parsed.totals).toBeUndefined();
    expect(parsed.shippingAddress).toBeUndefined();
    expect(parsed.billingAddress).toBeUndefined();
    expect(parsed.parseWarnings).toHaveLength(0);
  });

  it('warns when items is present-but-wrong-type', () => {
    const parsed = parseOrderSnapshot({ id: 'ol_order_abc', items: 'not-an-array' });

    expect(parsed.items).toEqual([]);
    expect(parsed.parseWarnings.some((w) => w.field === 'items')).toBe(true);
  });
});
