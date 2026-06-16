/**
 * Erli Order Mapper — unit tests (#994)
 *
 * Locks the Erli order → IncomingOrder translation: the status table, the
 * COD-arrives-paid payment encoding, totals derivation, address mapping, and
 * raw-PII passthrough (no internal `ol_*` ids — the #995 identity boundary).
 *
 * PROVISIONAL (#992): fixtures are AUTHORED (sandbox capture impossible until
 * the #992 spike), typed against the provisional wire shapes in
 * `erli-order.types.ts`. They MUST be re-asserted once the spike confirms the
 * real Erli order JSON. PII in fixtures is obviously-fake test data — never real
 * customer data or credentials.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import type { ErliOrder } from '../erli-order.types';
import { mapErliOrderToIncomingOrder } from '../erli-order.mapper';

// --- Authored, obviously-fake fixtures (#992-PROVISIONAL) ---------------------
const FAKE_SHIPPING_ADDRESS = {
  firstName: 'Jan',
  lastName: 'Testowy',
  street: 'ul. Testowa 1',
  city: 'Testowo',
  postalCode: '00-001',
  countryCode: 'PL',
  phone: '+48000000000',
};

function buildErliOrder(overrides: Partial<ErliOrder> = {}): ErliOrder {
  return {
    id: 'erli-order-1001',
    orderNumber: 'ERL-1001',
    status: 'purchased',
    paymentMethod: 'cod',
    buyer: {
      id: 'erli-buyer-1',
      email: 'buyer-1@example.test',
      firstName: 'Jan',
      lastName: 'Testowy',
    },
    lineItems: [
      {
        id: 'line-1',
        productExternalId: 'erli-prod-aaa',
        quantity: 2,
        price: { amount: 50, currency: 'PLN' },
        sku: 'SKU-AAA',
        name: 'Test Widget',
      },
    ],
    totals: {
      subtotal: 100,
      tax: 0,
      shipping: 10,
      total: 110,
      currency: 'PLN',
    },
    shippingAddress: { ...FAKE_SHIPPING_ADDRESS },
    createdAt: '2026-06-16T10:00:00.000Z',
    updatedAt: '2026-06-16T10:05:00.000Z',
    placedAt: '2026-06-16T09:59:00.000Z',
    ...overrides,
  };
}

describe('mapErliOrderToIncomingOrder', () => {
  it('should map a COD order to processing + paymentStatus cod when status is purchased and method is cod', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder({ status: 'purchased', paymentMethod: 'cod' }));

    expect(result.status).toBe('processing');
    expect(result.paymentStatus).toBe('cod');
  });

  it('should map a settled online order to processing + paymentStatus paid when status is purchased and method is payu', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder({ status: 'purchased', paymentMethod: 'payu' }));

    expect(result.status).toBe('processing');
    expect(result.paymentStatus).toBe('paid');
  });

  it('should map a pending online order to pending + paymentStatus awaiting when status is pending', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder({ status: 'pending', paymentMethod: 'payu' }));

    expect(result.status).toBe('pending');
    expect(result.paymentStatus).toBe('awaiting');
  });

  it('should map a cancelled order to cancelled with undefined paymentStatus when status is cancelled', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder({ status: 'cancelled' }));

    expect(result.status).toBe('cancelled');
    expect(result.paymentStatus).toBeUndefined();
  });

  it('should fall back to pending when the status is unknown', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ status: 'shipped' as unknown as ErliOrder['status'] })
    );

    expect(result.status).toBe('pending');
    expect(result.paymentStatus).toBeUndefined();
  });

  it('should map all line items and reconcile totals when the order has multiple lines', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        lineItems: [
          {
            id: 'line-1',
            productExternalId: 'erli-prod-aaa',
            quantity: 2,
            price: { amount: 50, currency: 'PLN' },
            sku: 'SKU-AAA',
            name: 'Test Widget',
          },
          {
            id: 'line-2',
            productExternalId: 'erli-prod-bbb',
            quantity: 1,
            price: { amount: 30, currency: 'PLN' },
            sku: 'SKU-BBB',
            name: 'Test Gadget',
          },
        ],
        totals: { subtotal: 130, tax: 0, shipping: 10, total: 140, currency: 'PLN' },
      })
    );

    expect(result.items).toHaveLength(2);
    expect(result.items[0].productRef).toEqual({ type: 'variant', externalId: 'erli-prod-aaa' });
    expect(result.items[0].price).toBe(50);
    expect(result.items[0].quantity).toBe(2);
    expect(result.items[1].productRef).toEqual({ type: 'variant', externalId: 'erli-prod-bbb' });
    expect(result.totals.subtotal).toBe(130);
    expect(result.totals.total).toBe(140);
  });

  it('should derive safe defaults when optional fields are missing', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        buyer: { id: 'erli-buyer-2' },
        totals: { total: 110, currency: 'PLN' },
        shippingAddress: undefined,
        billingAddress: undefined,
        placedAt: undefined,
      })
    );

    // tax defaults to 0
    expect(result.totals.tax).toBe(0);
    // subtotal derived from Σ(price × qty) = 50 × 2 = 100
    expect(result.totals.subtotal).toBe(100);
    // shipping derived from max(0, total − subtotal) = 110 − 100 = 10
    expect(result.totals.shipping).toBe(10);
    // omitted optionals
    expect(result.customerEmail).toBeUndefined();
    expect(result.shippingAddress).toBeUndefined();
    expect(result.billingAddress).toBeUndefined();
    expect(result.placedAt).toBeUndefined();
  });

  it('should fall back to ingestion time when createdAt/updatedAt are absent', () => {
    const before = Date.now();
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({ createdAt: undefined, updatedAt: undefined })
    );
    const after = Date.now();

    expect(typeof result.createdAt).toBe('string');
    expect(typeof result.updatedAt).toBe('string');
    const created = new Date(result.createdAt).getTime();
    expect(created).toBeGreaterThanOrEqual(before);
    expect(created).toBeLessThanOrEqual(after);
  });

  it('should pass buyer/PII fields through raw without identifier mapping', () => {
    const order = buildErliOrder();
    const result = mapErliOrderToIncomingOrder(order);

    expect(result.customerExternalId).toBe(order.buyer.id);
    expect(result.customerEmail).toBe(order.buyer.email);
    expect(result.metadata).toEqual({
      buyer: { id: order.buyer.id, email: order.buyer.email },
    });
  });

  it('should map the shipping address field-for-field onto IncomingOrderAddress', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder());

    expect(result.shippingAddress).toEqual({
      firstName: 'Jan',
      lastName: 'Testowy',
      company: undefined,
      address1: 'ul. Testowa 1',
      address2: undefined,
      city: 'Testowo',
      state: undefined,
      postalCode: '00-001',
      country: 'PL',
      phone: '+48000000000',
    });
  });

  it('should map the billing address field-for-field when present', () => {
    const result = mapErliOrderToIncomingOrder(
      buildErliOrder({
        billingAddress: {
          firstName: 'Anna',
          lastName: 'Przykład',
          company: 'Test Sp. z o.o.',
          street: 'ul. Fakturowa 7',
          street2: 'lok. 3',
          city: 'Rachunkowo',
          region: 'Mazowieckie',
          postalCode: '11-111',
          countryCode: 'PL',
          phone: '+48111111111',
        },
      })
    );

    expect(result.billingAddress).toEqual({
      firstName: 'Anna',
      lastName: 'Przykład',
      company: 'Test Sp. z o.o.',
      address1: 'ul. Fakturowa 7',
      address2: 'lok. 3',
      city: 'Rachunkowo',
      state: 'Mazowieckie',
      postalCode: '11-111',
      country: 'PL',
      phone: '+48111111111',
    });
  });

  it('should never emit an internal ol_ id anywhere in the output (the #995 identity boundary)', () => {
    const result = mapErliOrderToIncomingOrder(buildErliOrder());

    // Asserts the internal-id SHAPE (`ol_<entity>_…`), not an incidental `ol_`
    // substring — catches `ol_variant_`/`ol_product_`/`ol_order_` prefixes.
    expect(JSON.stringify(result)).not.toMatch(/ol_[a-z]+_/);
  });
});
