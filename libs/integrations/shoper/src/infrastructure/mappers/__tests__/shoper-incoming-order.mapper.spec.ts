import {
  mapShoperOrderStatus,
  mapShoperOrderToIncoming,
  mapShoperPaymentStatus,
  shopLocalToIso,
} from '../shoper-incoming-order.mapper';
import {
  LINES,
  WARSAW,
  buildLineRow,
  buildOrderRow,
} from '../../adapters/order-source/__tests__/shoper-order-source-test-data';

const status = (type: number, ...labels: string[]): { type: number; labels: string[] } => ({ type, labels });

const CTX = {
  status: status(3, 'przesyłka wysłana'),
  currencyCode: 'PLN',
  shippingName: 'Odbiór osobisty',
  timezone: WARSAW,
};

describe('shopLocalToIso', () => {
  it.each([
    ['summer time (CEST, +02:00)', '2026-09-26 13:12:16', '2026-09-26T11:12:16.000Z'],
    ['winter time (CET, +01:00)', '2026-01-15 10:00:00', '2026-01-15T09:00:00.000Z'],
    ['the T separator', '2026-09-26T13:12:16', '2026-09-26T11:12:16.000Z'],
  ])('should read %s in the shop time zone', (_name, local, expected) => {
    expect(shopLocalToIso(local, WARSAW)).toBe(expected);
  });

  it('should read the value as UTC when the zone is unknown', () => {
    expect(shopLocalToIso('2026-09-26 13:12:16', null)).toBe('2026-09-26T13:12:16.000Z');
  });

  it('should fall back to UTC rather than throw on an unusable zone', () => {
    expect(shopLocalToIso('2026-09-26 13:12:16', 'Not/AZone')).toBe('2026-09-26T13:12:16.000Z');
  });

  it.each([[''], ['yesterday'], ['2026-13-40 99:99:99'], [null], [undefined]])(
    'should return null for the unreadable value %p',
    (value) => {
      expect(shopLocalToIso(value, WARSAW)).toBeNull();
    },
  );
});

describe('mapShoperOrderStatus', () => {
  it.each([
    [1, 'pending'],
    [2, 'processing'],
    [3, 'shipped'],
    [9, 'pending'],
  ])('should map the status type %p to %p', (type, expected) => {
    expect(mapShoperOrderStatus(status(type))).toBe(expected);
  });

  it('should read an unlisted status as pending', () => {
    expect(mapShoperOrderStatus(null)).toBe('pending');
  });

  it.each([
    ['anulowane'],
    ['odrzucone'],
    ['Cancelled'],
    [''],
  ])('should read the terminal status "%s" as cancelled', (label) => {
    expect(mapShoperOrderStatus(status(4, label))).toBe('cancelled');
  });

  it.each([
    ['zwrócone'],
    ['Zwrot towaru'],
    ['Refunded'],
    ['Returned'],
    ['Rückerstattet'],
  ])('should read the terminal status "%s" as refunded, not cancelled', (label) => {
    expect(mapShoperOrderStatus(status(4, label))).toBe('refunded');
  });

  it('should read every language label of a terminal status', () => {
    expect(mapShoperOrderStatus(status(4, 'canceled order', 'zwrócone'))).toBe('refunded');
  });
});

describe('mapShoperPaymentStatus', () => {
  it('should report cod for a cash-on-delivery order, before anything else', () => {
    expect(mapShoperPaymentStatus(buildOrderRow({ is_cash_on_delivery: true, is_paid: true }), status(2))).toBe('cod');
  });

  it('should report paid when Shoper says the order is paid', () => {
    expect(mapShoperPaymentStatus(buildOrderRow(), status(3))).toBe('paid');
  });

  it('should report NOTHING for an unpaid order, since awaiting would block dispatch', () => {
    // Orders 4 and 9 of the live shop: shipped, paid 0.00, paid at pickup. A reported
    // `awaiting` would make OpenLinker refuse their shipping label.
    expect(mapShoperPaymentStatus(buildOrderRow({ is_paid: false, paid: '0.00', sum: '214.35' }), status(1))).toBeUndefined();
    expect(mapShoperPaymentStatus(buildOrderRow({ is_paid: false, paid: '0.00', sum: '999.00' }), status(3))).toBeUndefined();
  });

  it('should report nothing for a part-payment, a zero sum or a terminal status', () => {
    expect(mapShoperPaymentStatus(buildOrderRow({ is_paid: false, paid: '10.00', sum: '214.35' }), status(2))).toBeUndefined();
    expect(mapShoperPaymentStatus(buildOrderRow({ is_paid: false, paid: '0.00', sum: '0.00' }), status(1))).toBeUndefined();
    expect(mapShoperPaymentStatus(buildOrderRow({ is_paid: false, paid: '0.00', sum: '99.00' }), status(4))).toBeUndefined();
    expect(mapShoperPaymentStatus(buildOrderRow({ is_paid: true }), status(4, 'zwrócone'))).toBeUndefined();
  });
});

describe('mapShoperOrderToIncoming', () => {
  it('should map a paid order with its lines, at the price the buyer paid', () => {
    const incoming = mapShoperOrderToIncoming(buildOrderRow(), LINES, CTX);

    expect(incoming).toMatchObject({
      externalOrderId: '2',
      orderNumber: '2',
      externalUrl: 'https://sklep729770.shoparena.pl/pl/panel/order/2',
      status: 'shipped',
      paymentStatus: 'paid',
      customerExternalId: '2',
      customerEmail: 'email@example.com',
      placedAt: '2026-09-27T11:12:16.000Z',
      createdAt: '2026-09-27T11:12:16.000Z',
      updatedAt: '2026-09-28T04:12:16.000Z',
      shipping: { methodId: '8', methodName: 'Odbiór osobisty' },
    });
    expect(incoming.items).toEqual([
      {
        id: '9',
        productRef: { type: 'variant', externalId: '201' },
        quantity: 1,
        price: 59.48,
        unitPriceGross: 59.48,
        sku: '1E72-8147C_20250917132509',
        name: 'Żebrowana miska Miętowy Rozkwit',
        taxRate: '23',
      },
      {
        id: '10',
        productRef: { type: 'variant', externalId: '195' },
        quantity: 1,
        price: 74.36,
        unitPriceGross: 74.36,
        sku: '1E72-8147C_20250917130650',
        name: 'Ceramiczny talerz Morning Mist',
        taxRate: '23',
      },
    ]);
  });

  it('should declare gross totals and derive the contained tax by division', () => {
    const { totals } = mapShoperOrderToIncoming(buildOrderRow(), LINES, CTX);

    expect(totals).toEqual({
      subtotal: 133.84,
      // 59.48 - 59.48/1.23 + 74.36 - 74.36/1.23, never gross * rate
      tax: 25.03,
      shipping: 0,
      total: 133.84,
      currency: 'PLN',
      taxTreatment: 'inclusive',
      shippingGross: 0,
    });
  });

  it('should include the shipping tax and split the shipping out of the subtotal', () => {
    const { totals } = mapShoperOrderToIncoming(
      buildOrderRow({ sum: '143.84', shipping_cost: '10.00' }),
      LINES,
      CTX,
    );

    expect(totals.shipping).toBe(10);
    expect(totals.subtotal).toBe(133.84);
    // + 10 - 10/1.23
    expect(totals.tax).toBe(26.9);
  });

  it('should leave a line tax rate ABSENT when Shoper stored an unreadable one', () => {
    const [line] = mapShoperOrderToIncoming(
      buildOrderRow(),
      [buildLineRow({ tax: 'weird', tax_value: '' })],
      CTX,
    ).items;

    expect(line).not.toHaveProperty('taxRate');
  });

  it.each([
    ['zw.', 'zw'],
    ['np.', 'np'],
    ['8%', '8'],
    ['0%', '0'],
  ])('should read the line tax "%s" as the code %s', (tax, code) => {
    const [line] = mapShoperOrderToIncoming(buildOrderRow(), [buildLineRow({ tax })], CTX).items;

    expect(line?.taxRate).toBe(code);
  });

  it('should point a line without a stock id at the product, then the sku, then the line id', () => {
    const refs = mapShoperOrderToIncoming(
      buildOrderRow(),
      [
        buildLineRow({ id: '1', stock_id: null }),
        buildLineRow({ id: '2', stock_id: null, product_id: null }),
        buildLineRow({ id: '3', stock_id: null, product_id: null, code: '' }),
      ],
      CTX,
    ).items.map((item) => item.productRef);

    expect(refs).toEqual([
      { type: 'product', externalId: '113' },
      { type: 'sku', externalId: '1E72-8147C_20250917132509' },
      { type: 'sku', externalId: '3' },
    ]);
  });

  it('should read a blank buyer tax id as UNKNOWN and a real one verbatim', () => {
    const incoming = mapShoperOrderToIncoming(buildOrderRow(), LINES, CTX);

    expect(incoming.shippingAddress).not.toHaveProperty('taxId');
    expect(incoming.billingAddress).toMatchObject({ taxId: '5252556107', company: 'Kowalska Sp. z o.o.' });
  });

  it('should map the delivery address with an upper-cased country', () => {
    const incoming = mapShoperOrderToIncoming(buildOrderRow(), LINES, CTX);

    expect(incoming.shippingAddress).toEqual({
      firstName: 'Anna',
      lastName: 'Kowalska',
      address1: 'Warszawska 543/123',
      city: 'Kraków',
      postalCode: '31-345',
      country: 'PL',
      phone: '300542832',
    });
  });

  it('should not invent a placement time, and fall back to the epoch only for the bookkeeping fields', () => {
    const incoming = mapShoperOrderToIncoming(buildOrderRow({ date: null, status_date: null }), LINES, CTX);

    expect(incoming).not.toHaveProperty('placedAt');
    expect(incoming.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(incoming.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('should ask for the cash on delivery amount only for a COD order', () => {
    const cod = mapShoperOrderToIncoming(
      buildOrderRow({ is_cash_on_delivery: true, is_paid: false, paid: '0.00' }),
      LINES,
      CTX,
    );
    const prepaid = mapShoperOrderToIncoming(buildOrderRow(), LINES, CTX);

    expect(cod.codToCollect).toEqual({ amount: '133.84', currency: 'PLN' });
    expect(cod.paymentStatus).toBe('cod');
    expect(prepaid).not.toHaveProperty('codToCollect');
  });

  it('should drop a guest/blank customer id and an address with no street and no city', () => {
    const incoming = mapShoperOrderToIncoming(
      buildOrderRow({ user_id: '0', delivery_address: { street1: '', city: '' } }),
      LINES,
      CTX,
    );

    expect(incoming).not.toHaveProperty('customerExternalId');
    expect(incoming).not.toHaveProperty('shippingAddress');
  });
});
