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

  it('should leave buyerHasTaxId undefined when no address asserted a tax id, even for a company buyer (#2599)', () => {
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

  it('should report buyerHasTaxId true from the billing address tax id (#2599)', () => {
    const order = makeOrder({
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
      },
      billingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
        taxId: '1234567890',
      },
    });

    expect(toSalesDocumentOrderFacts(order)?.buyerHasTaxId).toBe(true);
  });

  it('should report buyerHasTaxId false only when the source asserted the buyer has none (#2599)', () => {
    const order = makeOrder({
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
        taxId: null,
      },
    });

    expect(toSalesDocumentOrderFacts(order)?.buyerHasTaxId).toBe(false);
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

  it('should prefer totalTaxTreatment over taxTreatment when a source asserts total is gross despite net line prices (#2829)', () => {
    const order = makeOrder({
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
      },
      totals: {
        subtotal: 83.32,
        tax: 16.67,
        shipping: 5,
        total: 99.99,
        currency: 'PLN',
        // PrestaShop-shaped: line prices/subtotal are net, but the order
        // total is genuinely gross.
        taxTreatment: 'exclusive',
        totalTaxTreatment: 'inclusive',
      },
    });

    const facts = toSalesDocumentOrderFacts(order);

    expect(facts?.taxTreatment).toBe('inclusive');
    expect(facts?.totalGross).toBe(99.99);
  });

  it('should fall back to taxTreatment when totalTaxTreatment is absent', () => {
    const order = makeOrder({
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
      },
      totals: {
        subtotal: 20,
        tax: 0,
        shipping: 0,
        total: 20,
        currency: 'PLN',
        taxTreatment: 'exclusive',
      },
    });

    expect(toSalesDocumentOrderFacts(order)?.taxTreatment).toBe('exclusive');
  });

  it('should honour totalTaxTreatment even when it disagrees downward from taxTreatment', () => {
    // The fallback is `totalTaxTreatment ?? taxTreatment`, which must win in
    // BOTH directions — the sibling test above only proves the
    // exclusive→inclusive override; a regression to `||` or a truthiness
    // check would still pass that one but silently ignore an explicit
    // `'exclusive'` here (a falsy-looking-but-defined string is never the
    // failure mode of `??`, so this guards the direction `||` would break).
    const order = makeOrder({
      shippingAddress: {
        address1: 'ul. Testowa 1',
        city: 'Poznań',
        postalCode: '60-001',
        country: 'PL',
      },
      totals: {
        subtotal: 20,
        tax: 0,
        shipping: 0,
        total: 20,
        currency: 'PLN',
        taxTreatment: 'inclusive',
        totalTaxTreatment: 'exclusive',
      },
    });

    expect(toSalesDocumentOrderFacts(order)?.taxTreatment).toBe('exclusive');
  });
});
