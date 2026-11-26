/**
 * Mirakl Order Mapper: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import { mapMiraklOrderToIncomingOrder, singleTaxRate } from '../mirakl-order.mapper';
import { buildMiraklOrder, buildMiraklOrderLine } from './mirakl-order.fixture';

describe('mapMiraklOrderToIncomingOrder', () => {
  it('should map a paid locker order', () => {
    const incoming = mapMiraklOrderToIncomingOrder(buildMiraklOrder());

    expect(incoming).toMatchObject({
      externalOrderId: '1001-A',
      orderNumber: '1001-A',
      status: 'processing',
      customerExternalId: 'cust-1',
      customerEmail: 'anna@example.test',
      paymentStatus: 'paid',
      paymentMethod: 'online',
      shipping: { methodId: 'PACKSTATION', methodName: 'Paczkomaty InPost' },
      pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A', pointType: 'apm' },
      dispatchTime: { to: '2026-11-25T15:00:00Z' },
      placedAt: '2026-11-23T09:00:00Z',
      updatedAt: '2026-11-23T09:30:00Z',
      metadata: { orderState: 'SHIPPING', orderType: 'Standard' },
    });
    expect(incoming.codToCollect).toBeUndefined();
  });

  it('should map the line to an offer reference with gross price and VAT', () => {
    const [item] = mapMiraklOrderToIncomingOrder(buildMiraklOrder()).items;

    expect(item).toEqual({
      id: '1001-A-1',
      productRef: { type: 'offer', externalId: 'SKU-RED-M' },
      quantity: 2,
      price: 49.99,
      unitPriceGross: 49.99,
      sku: 'SKU-RED-M',
      name: 'Koszulka czerwona M',
      imageUrl: 'https://example.test/p-2001.jpg',
      taxRate: '23',
      taxRateCountry: 'PL',
    });
  });

  it('should name the product instead of the offer when the connection is the catalogue master', () => {
    const [item] = mapMiraklOrderToIncomingOrder(buildMiraklOrder(), { lineRef: 'product' }).items;

    expect(item.productRef).toEqual({ type: 'product', externalId: 'SKU-RED-M' });
  });

  it('should map gross totals that add up', () => {
    const { totals } = mapMiraklOrderToIncomingOrder(buildMiraklOrder());

    expect(totals).toEqual({
      subtotal: 99.98,
      tax: 0,
      shipping: 12.99,
      total: 112.97,
      currency: 'PLN',
      taxTreatment: 'inclusive',
      shippingGross: 12.99,
      shippingTaxRate: '23',
    });
  });

  it('should put the NIP and an alpha-2 country on the billing address', () => {
    const incoming = mapMiraklOrderToIncomingOrder(buildMiraklOrder());

    expect(incoming.billingAddress).toMatchObject({
      address1: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
      taxId: '5260250995',
    });
    expect(incoming.shippingAddress?.taxId).toBeUndefined();
  });

  it('should fall back to the organization tax number and the shipping address', () => {
    const order = buildMiraklOrder({
      order_additional_fields: [],
      customer: {
        ...buildMiraklOrder().customer,
        billing_address: undefined,
        organization: { tax_identification_number: 'PL5260250995' },
      },
    });

    const incoming = mapMiraklOrderToIncomingOrder(order);

    expect(incoming.billingAddress).toBeUndefined();
    expect(incoming.shippingAddress?.taxId).toBe('PL5260250995');
    expect(incoming.customerEmail).toBe('relay-1@marketplace.example.test');
  });

  it('should treat a _POD shipping type as cash on delivery', () => {
    const incoming = mapMiraklOrderToIncomingOrder(
      buildMiraklOrder({ shipping_type_code: 'COURIER_POD', shipping_pudo_id: undefined })
    );

    expect(incoming.paymentMethod).toBe('cash_on_delivery');
    expect(incoming.paymentStatus).toBe('cod');
    expect(incoming.codToCollect).toEqual({ amount: '112.97', currency: 'PLN' });
  });

  it.each([
    ['WAITING_DEBIT', 'pending', 'awaiting'],
    ['WAITING_DEBIT_PAYMENT', 'pending', 'awaiting'],
    ['SHIPPED', 'shipped', 'paid'],
    ['TO_COLLECT', 'shipped', 'paid'],
    ['RECEIVED', 'delivered', 'paid'],
    ['CLOSED', 'delivered', 'paid'],
    ['CANCELED', 'cancelled', undefined],
    ['REFUSED', 'cancelled', undefined],
  ])('should map state %s to %s / %p', (state, status, paymentStatus) => {
    const incoming = mapMiraklOrderToIncomingOrder(buildMiraklOrder({ order_state: state }));

    expect(incoming.status).toBe(status);
    expect(incoming.paymentStatus).toBe(paymentStatus);
  });

  it('should report a fully refunded order as refunded', () => {
    expect(
      mapMiraklOrderToIncomingOrder(buildMiraklOrder({ fully_refunded: true })).paymentStatus
    ).toBe('refunded');
  });

  it('should drop refused lines while an active line remains', () => {
    const order = buildMiraklOrder({
      order_lines: [
        buildMiraklOrderLine(),
        buildMiraklOrderLine({ order_line_id: '1001-A-2', order_line_state: 'REFUSED' }),
      ],
    });

    expect(mapMiraklOrderToIncomingOrder(order).items.map((item) => item.id)).toEqual(['1001-A-1']);
  });

  it('should keep every line of a fully cancelled order', () => {
    const order = buildMiraklOrder({
      order_state: 'CANCELED',
      order_lines: [buildMiraklOrderLine({ order_line_state: 'CANCELED' })],
    });

    expect(mapMiraklOrderToIncomingOrder(order).items).toHaveLength(1);
  });

  it('should add stated taxes to a net order total', () => {
    const { totals } = mapMiraklOrderToIncomingOrder(
      buildMiraklOrder({
        order_tax_mode: 'TAX_EXCLUDED',
        price: 81.28,
        shipping_price: 10.56,
        total_price: 91.84,
      })
    );

    expect(totals).toMatchObject({
      subtotal: 81.28,
      tax: 21.13,
      shipping: 10.56,
      total: 112.97,
      taxTreatment: 'exclusive',
      totalTaxTreatment: 'inclusive',
    });
  });

  it('should leave the pickup point out of a courier order without a point', () => {
    const incoming = mapMiraklOrderToIncomingOrder(
      buildMiraklOrder({
        shipping_type_code: 'COURIER',
        shipping_pudo_id: undefined,
        order_additional_fields: [],
      })
    );

    expect(incoming.pickupPoint).toBeUndefined();
  });
});

describe('singleTaxRate', () => {
  it('should format a single rate', () => {
    expect(singleTaxRate([{ rate: 8 }])).toBe('8');
    expect(singleTaxRate([{ rate: 5.5 }])).toBe('5.5');
  });

  it('should return undefined for several rates or none', () => {
    expect(singleTaxRate([{ rate: 8 }, { rate: 23 }])).toBeUndefined();
    expect(singleTaxRate([])).toBeUndefined();
    expect(singleTaxRate(undefined)).toBeUndefined();
  });
});
