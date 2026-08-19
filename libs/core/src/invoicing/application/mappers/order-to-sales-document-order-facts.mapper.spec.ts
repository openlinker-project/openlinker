/**
 * toSalesDocumentOrderFacts — unit spec (#2173)
 *
 * @module libs/core/src/invoicing/application/mappers
 */
import { toSalesDocumentOrderFacts } from './order-to-sales-document-order-facts.mapper';
import type { Order } from '@openlinker/core/orders';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    status: 'processing',
    items: [{ id: 'i1', productId: 'p1', quantity: 2, price: 10, name: 'Widget' }],
    totals: {
      subtotal: 20,
      tax: 0,
      shipping: 0,
      total: 20,
      currency: 'PLN',
      taxTreatment: 'inclusive',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('toSalesDocumentOrderFacts (#2173)', () => {
  it('should build facts from the delivery (shipping) address country, never billing', () => {
    const order = makeOrder({
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
      },
      billingAddress: {
        address1: 'ul. Inna 2',
        city: 'Berlin',
        postalCode: '10115',
        country: 'DE',
      },
    });

    const facts = toSalesDocumentOrderFacts(order);

    expect(facts).toEqual({
      country: 'PL',
      totalGross: 20,
      currency: 'PLN',
      taxTreatment: 'inclusive',
      buyerHasTaxId: undefined,
    });
  });

  it('should return null when the order has no shipping address at all (never falls back to billing)', () => {
    const order = makeOrder({
      billingAddress: {
        address1: 'ul. Inna 2',
        city: 'Berlin',
        postalCode: '10115',
        country: 'DE',
      },
    });

    expect(toSalesDocumentOrderFacts(order)).toBeNull();
  });

  it('should return null when the shipping address country is a blank string', () => {
    const order = makeOrder({
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: '   ',
      },
    });

    expect(toSalesDocumentOrderFacts(order)).toBeNull();
  });

  it('should always set buyerHasTaxId to undefined, never inferred or defaulted to false', () => {
    const order = makeOrder({
      shippingAddress: {
        company: 'Acme Sp. z o.o.',
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
      },
    });

    const facts = toSalesDocumentOrderFacts(order);

    expect(facts?.buyerHasTaxId).toBeUndefined();
  });

  it('should carry taxTreatment verbatim, including absent (never re-derived)', () => {
    const order = makeOrder({
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
      },
      totals: {
        subtotal: 100,
        tax: 0,
        shipping: 0,
        total: 100,
        currency: 'EUR',
        // taxTreatment intentionally absent
      },
    });

    const facts = toSalesDocumentOrderFacts(order);

    expect(facts?.taxTreatment).toBeUndefined();
    expect(facts?.currency).toBe('EUR');
    expect(facts?.totalGross).toBe(100);
  });
});
