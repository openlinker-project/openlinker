import type { OrderCreate } from '@openlinker/core/orders';

import { SHOPIFY_COD_GATEWAY } from '../../../shopify.constants';
import {
  buildShopifyOrderCreateVariables,
  pickupPointAttributes,
  shopifyOrderDiscount,
  type ShopifyResolvedLine,
} from '../shopify-order-input.mapper';

function order(overrides: Partial<OrderCreate> = {}): OrderCreate {
  return {
    status: 'pending',
    orderNumber: 'A-100',
    items: [{ id: 'l1', productId: 'p1', variantId: 'v1', quantity: 2, price: 123, taxRate: '23', name: 'Shirt' }],
    totals: { subtotal: 246, tax: 0, shipping: 15, total: 261, currency: 'PLN' },
    shipping: { methodId: 'allegro-paczkomaty', methodName: 'Paczkomaty InPost' },
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Nowak',
      address1: 'Prosta 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'pl',
      phone: '+48500100200',
    },
    paymentStatus: 'paid',
    ...overrides,
  } as OrderCreate;
}

const VARIANT_LINE = (o: OrderCreate): ShopifyResolvedLine[] => [
  { item: o.items[0], variantGid: 'gid://shopify/ProductVariant/9', requiresShipping: true },
];

describe('buildShopifyOrderCreateVariables', () => {
  it('should charge the buyer price gross with the tax contained in it', () => {
    const o = order();
    const { order: input, options } = buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), 'ol_order_1');

    expect(input).toMatchObject({
      currency: 'PLN',
      taxesIncluded: true,
      financialStatus: 'PAID',
      sourceIdentifier: 'ol_order_1',
      tags: ['openlinker'],
      lineItems: [
        {
          variantId: 'gid://shopify/ProductVariant/9',
          quantity: 2,
          priceSet: { shopMoney: { amount: '123.00', currencyCode: 'PLN' } },
          taxLines: [{ title: 'VAT 23%', rate: '0.2300', priceSet: { shopMoney: { amount: '46.00' } } }],
        },
      ],
      transactions: [{ kind: 'SALE', status: 'SUCCESS', gateway: 'manual' }],
      shippingAddress: { countryCode: 'PL', zip: '00-001', address1: 'Prosta 1' },
    });
    expect(options).toEqual({
      inventoryBehaviour: 'DECREMENT_OBEYING_POLICY',
      sendReceipt: false,
      sendFulfillmentReceipt: false,
    });
  });

  it('should send a net-priced order net, with the tax on top', () => {
    const o = order({ totals: { subtotal: 100, tax: 23, shipping: 0, total: 123, currency: 'PLN', taxTreatment: 'exclusive' } });
    o.items[0] = { ...o.items[0], quantity: 1, price: 100, unitPriceGross: 123 };

    const { order: input } = buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), undefined);

    expect(input).toMatchObject({
      taxesIncluded: false,
      lineItems: [{ priceSet: { shopMoney: { amount: '100.00' } }, taxLines: [{ priceSet: { shopMoney: { amount: '23.00' } } }] }],
    });
    expect(input).not.toHaveProperty('sourceIdentifier');
  });

  it('should add no tax line for an exemption code or a missing rate', () => {
    const o = order();
    o.items[0] = { ...o.items[0], taxRate: 'zw' };

    const { order: input } = buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), undefined);

    expect((input.lineItems as Array<Record<string, unknown>>)[0]).not.toHaveProperty('taxLines');
  });

  it('should state on a variant line whether it ships, since Shopify defaults every line to no shipping (D1)', () => {
    const o = order();
    const shipped = buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), undefined).order;
    const digital = buildShopifyOrderCreateVariables(
      o,
      [{ item: o.items[0], variantGid: 'gid://shopify/ProductVariant/9', requiresShipping: false }],
      undefined,
    ).order;

    expect((shipped.lineItems as Array<Record<string, unknown>>)[0]).toMatchObject({ requiresShipping: true });
    expect((digital.lineItems as Array<Record<string, unknown>>)[0]).toMatchObject({ requiresShipping: false });
  });

  it('should send a whole-order discount as a fixed-amount code and tax the discounted lines', () => {
    // Two lines of 100 gross with a 20 coupon applied to the order: the buyer paid 180 + 15 shipping.
    const o = order({
      items: [
        { id: 'l1', productId: 'p1', variantId: 'v1', quantity: 1, price: 100, taxRate: '23', name: 'A' },
        { id: 'l2', productId: 'p2', variantId: 'v2', quantity: 1, price: 100, taxRate: '23', name: 'B' },
      ],
      totals: { subtotal: 200, tax: 0, shipping: 15, total: 195, currency: 'PLN', discountTotal: 20 },
    } as Partial<OrderCreate>);
    const lines: ShopifyResolvedLine[] = o.items.map((item, i) => ({
      item,
      variantGid: `gid://shopify/ProductVariant/${i + 1}`,
      requiresShipping: true,
    }));

    const { order: input } = buildShopifyOrderCreateVariables(o, lines, undefined);

    expect(input.discountCode).toEqual({
      itemFixedDiscountCode: { code: 'OPENLINKER', amountSet: { shopMoney: { amount: '20.00', currencyCode: 'PLN' } } },
    });
    const items = input.lineItems as Array<Record<string, unknown>>;
    // Price stays the listed one; the tax is the tax contained in 90 (100 less its share of the 20).
    expect(items[0]).toMatchObject({
      priceSet: { shopMoney: { amount: '100.00' } },
      taxLines: [{ priceSet: { shopMoney: { amount: '16.83' } } }],
    });
    expect(input.transactions).toEqual([expect.objectContaining({ amountSet: { shopMoney: { amount: '195.00', currencyCode: 'PLN' } } })]);
  });

  it('should send no discount code when the order carries none or it cannot be split', () => {
    const o = order();
    expect(buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), undefined).order).not.toHaveProperty('discountCode');

    const tooBig = order({ totals: { subtotal: 246, tax: 0, shipping: 15, total: 15, currency: 'PLN', discountTotal: 246 } });
    expect(shopifyOrderDiscount(tooBig, VARIANT_LINE(tooBig))).toBeNull();
    expect(buildShopifyOrderCreateVariables(tooBig, VARIANT_LINE(tooBig), undefined).order).not.toHaveProperty(
      'discountCode',
    );
  });

  it('should create an unmapped line as a custom line that still ships', () => {
    const o = order();
    o.items[0] = { ...o.items[0], sku: 'SKU-1' };

    const { order: input } = buildShopifyOrderCreateVariables(
      o,
      [{ item: o.items[0], variantGid: null, requiresShipping: true }],
      undefined,
    );

    expect((input.lineItems as Array<Record<string, unknown>>)[0]).toMatchObject({
      title: 'Shirt',
      sku: 'SKU-1',
      requiresShipping: true,
    });
  });

  it('should carry the pickup point in the attributes, the note and the shipping title', () => {
    const o = order({ pickupPoint: { id: 'GIT01D', name: 'Paczkomat GIT01D', description: 'ul. Prosta 2' } });

    const { order: input } = buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), undefined);

    expect(input.customAttributes).toEqual([
      { key: 'Pickup point', value: 'GIT01D' },
      { key: 'Pickup point name', value: 'Paczkomat GIT01D' },
      { key: 'Pickup point address', value: 'ul. Prosta 2' },
    ]);
    expect(input.note).toBe('OpenLinker order A-100\nPickup point: GIT01D - Paczkomat GIT01D, ul. Prosta 2');
    expect(input.shippingLines).toEqual([
      expect.objectContaining({
        title: 'Paczkomaty InPost (GIT01D)',
        code: 'allegro-paczkomaty',
        priceSet: { shopMoney: { amount: '15.00', currencyCode: 'PLN' } },
      }),
    ]);
  });

  it('should use the mapped delivery method and gateway', () => {
    const o = order();

    const { order: input } = buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), undefined, {
      deliveryMethod: 'Standard',
      paymentGateway: 'PayU',
    });

    expect(input.shippingLines).toEqual([expect.objectContaining({ title: 'Standard', code: 'Standard' })]);
    expect(input.transactions).toEqual([expect.objectContaining({ status: 'SUCCESS', gateway: 'PayU' })]);
  });

  it('should leave a cash-on-delivery order pending on the COD gateway', () => {
    const o = order({ paymentStatus: 'cod' });

    const { order: input } = buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), undefined);

    expect(input.financialStatus).toBe('PENDING');
    expect(input.transactions).toEqual([
      expect.objectContaining({ status: 'PENDING', gateway: SHOPIFY_COD_GATEWAY, amountSet: { shopMoney: { amount: '261.00', currencyCode: 'PLN' } } }),
    ]);
  });

  it('should send no transaction for an unpaid order with no mapped gateway', () => {
    const o = order({ paymentStatus: 'awaiting' });

    const { order: input } = buildShopifyOrderCreateVariables(o, VARIANT_LINE(o), undefined);

    expect(input.financialStatus).toBe('PENDING');
    expect(input).not.toHaveProperty('transactions');
  });
});

describe('pickupPointAttributes', () => {
  it('should return nothing for a blank pickup point id', () => {
    expect(pickupPointAttributes({ id: '  ' })).toEqual([]);
    expect(pickupPointAttributes(undefined)).toEqual([]);
  });
});
