import type { ShopifyLineItem, ShopifyOrder } from '../../../domain/types/shopify-api.types';
import {
  mapShopifyOrderStatus,
  mapShopifyOrderToIncoming,
  mapShopifyPaymentStatus,
  shopifyTaxRateCode,
} from '../shopify-incoming-order.mapper';

const money = (amount: string): ShopifyOrder['currentTotalPriceSet'] => ({
  shopMoney: { amount, currencyCode: 'PLN' },
});

function line(overrides: Partial<ShopifyLineItem> = {}): ShopifyLineItem {
  return {
    id: 'gid://shopify/LineItem/1',
    name: 'Mug',
    sku: 'MUG-1',
    quantity: 2,
    currentQuantity: 2,
    variant: { id: 'gid://shopify/ProductVariant/11' },
    product: { id: 'gid://shopify/Product/7' },
    originalUnitPriceSet: money('38.99'),
    discountedUnitPriceAfterAllDiscountsSet: money('24.90'),
    taxLines: [{ title: 'VAT', rate: 0.23, ratePercentage: 23 }],
    ...overrides,
  };
}

function order(overrides: Partial<ShopifyOrder> = {}): ShopifyOrder {
  return {
    id: 'gid://shopify/Order/1011',
    name: '#1011',
    createdAt: '2026-11-04T10:00:00Z',
    updatedAt: '2026-11-04T10:00:02Z',
    processedAt: '2026-11-04T09:59:59Z',
    cancelledAt: null,
    displayFinancialStatus: 'PAID',
    displayFulfillmentStatus: 'UNFULFILLED',
    paymentGatewayNames: ['manual'],
    email: 'buyer@example.com',
    phone: null,
    note: null,
    taxesIncluded: true,
    currencyCode: 'PLN',
    presentmentCurrencyCode: 'PLN',
    customer: { id: 'gid://shopify/Customer/5' },
    currentTotalPriceSet: money('60.75'),
    currentSubtotalPriceSet: money('49.80'),
    currentTotalTaxSet: money('11.36'),
    currentShippingPriceSet: money('10.95'),
    purchasingEntity: null,
    shippingAddress: {
      firstName: 'Anna',
      lastName: 'Nowak',
      company: null,
      address1: 'Prosta 1',
      address2: null,
      city: 'Warszawa',
      provinceCode: null,
      zip: '00-001',
      countryCodeV2: 'PL',
      phone: '+48500000000',
    },
    billingAddress: null,
    shippingLines: {
      nodes: [
        {
          title: 'Standard',
          code: 'Standard',
          originalPriceSet: money('10.95'),
          taxLines: [{ title: 'VAT', rate: 0.23, ratePercentage: 23 }],
        },
      ],
    },
    lineItems: { nodes: [line()] },
    ...overrides,
  };
}

const CTX = { adminOrderUrl: 'https://admin.shopify.com/store/dev/orders/1011' };

describe('mapShopifyOrderToIncoming', () => {
  it('should carry the price the buyer paid per unit, gross, with the line tax rate', () => {
    const incoming = mapShopifyOrderToIncoming(order(), CTX);

    expect(incoming).toMatchObject({
      externalOrderId: '1011',
      orderNumber: '1011',
      status: 'processing',
      paymentStatus: 'paid',
      customerEmail: 'buyer@example.com',
      placedAt: '2026-11-04T09:59:59Z',
      totals: { total: 60.75, shipping: 10.95, currency: 'PLN', taxTreatment: 'inclusive', shippingTaxRate: '23' },
      shipping: { methodId: 'Standard', methodName: 'Standard' },
      buyerNote: null,
    });
    expect(incoming.items).toEqual([
      expect.objectContaining({
        id: '1',
        productRef: { type: 'variant', externalId: '11' },
        quantity: 2,
        price: 24.9,
        unitPriceGross: 24.9,
        taxRate: '23',
      }),
    ]);
  });

  it('should report lines and shipping after an order-level discount so they add up to the total', () => {
    // A 10% code on the whole order and free shipping: the line-only unit price
    // would stay 24.90 and shipping 10.95, adding up to more than was paid.
    const incoming = mapShopifyOrderToIncoming(
      order({
        lineItems: { nodes: [line({ discountedUnitPriceAfterAllDiscountsSet: money('22.41') })] },
        currentShippingPriceSet: money('0.00'),
        currentSubtotalPriceSet: money('44.82'),
        currentTotalPriceSet: money('44.82'),
      }),
      CTX,
    );

    expect(incoming.items[0]?.price).toBe(22.41);
    expect(incoming.totals.shipping).toBe(0);
    const linesAndShipping = incoming.items.reduce((sum, item) => sum + item.price * item.quantity, 0) +
      incoming.totals.shipping;
    expect(linesAndShipping).toBeCloseTo(incoming.totals.total, 2);
  });

  it('should use the quantity after edits and drop a line edited down to zero', () => {
    const incoming = mapShopifyOrderToIncoming(
      order({
        lineItems: {
          nodes: [line({ currentQuantity: 1 }), line({ id: 'gid://shopify/LineItem/2', currentQuantity: 0 })],
        },
      }),
      CTX,
    );

    expect(incoming.items).toHaveLength(1);
    expect(incoming.items[0]?.quantity).toBe(1);
  });

  it('should carry the B2B company tax id on the billing address (C08)', () => {
    const incoming = mapShopifyOrderToIncoming(
      order({
        purchasingEntity: {
          __typename: 'PurchasingCompany',
          location: { taxSettings: { taxRegistrationId: 'PL8113439670' } },
        },
        billingAddress: order().shippingAddress,
      }),
      CTX,
    );

    expect(incoming.billingAddress?.taxId).toBe('PL8113439670');
    expect(incoming.shippingAddress?.taxId).toBeUndefined();
  });

  it('should not assert a tax id for a consumer order', () => {
    const incoming = mapShopifyOrderToIncoming(order({ billingAddress: order().shippingAddress }), CTX);

    expect(incoming.billingAddress).not.toHaveProperty('taxId');
  });

  it('should read a pending cash-on-delivery order as COD with the total to collect', () => {
    const incoming = mapShopifyOrderToIncoming(
      order({ displayFinancialStatus: 'PENDING', paymentGatewayNames: ['Cash on Delivery (COD)'] }),
      CTX,
    );

    expect(incoming.paymentStatus).toBe('cod');
    expect(incoming.paymentMethod).toBe('cash_on_delivery');
    expect(incoming.codToCollect).toBeDefined();
  });

  it('should recognise a renamed cash-on-delivery method from the connection config and flag an unrecognised unpaid one', () => {
    const renamed = order({ displayFinancialStatus: 'PENDING', paymentGatewayNames: ['Płatność przy odbiorze'] });

    const unconfigured = mapShopifyOrderToIncoming(renamed, CTX);
    expect(unconfigured.codToCollect).toBeUndefined();
    expect(unconfigured.metadata).toMatchObject({ unrecognisedUnpaidGateway: 'Płatność przy odbiorze' });

    const configured = mapShopifyOrderToIncoming(renamed, { ...CTX, paymentGateways: { cod: ['płatność PRZY odbiorze'] } });
    expect(configured.paymentMethod).toBe('cash_on_delivery');
    expect(configured.codToCollect).toBeDefined();
    expect(configured.metadata).not.toHaveProperty('unrecognisedUnpaidGateway');
  });

  it('should keep the buyer tax id when no address survives, without inventing a country', () => {
    const incoming = mapShopifyOrderToIncoming(
      order({
        purchasingEntity: {
          __typename: 'PurchasingCompany',
          location: { taxSettings: { taxRegistrationId: 'PL8113439670' } },
        },
        shippingAddress: null,
        billingAddress: null,
      }),
      CTX,
    );

    expect(incoming.billingAddress).toMatchObject({ taxId: 'PL8113439670', country: '' });
    expect(incoming.shippingAddress).toBeUndefined();
  });

  it('should state a shipping tax rate only when every priced shipping line agrees on it', () => {
    const shippingLine = (rate: number, price: string): ShopifyOrder['shippingLines']['nodes'][number] => ({
      title: 'S',
      code: 'S',
      originalPriceSet: money(price),
      taxLines: [{ title: 'VAT', rate, ratePercentage: rate * 100 }],
    });
    const rateOf = (nodes: ShopifyOrder['shippingLines']['nodes']): string | undefined =>
      mapShopifyOrderToIncoming(order({ shippingLines: { nodes } }), CTX).totals.shippingTaxRate;

    expect(rateOf([shippingLine(0.23, '5.00'), shippingLine(0.23, '2.00')])).toBe('23');
    expect(rateOf([shippingLine(0.23, '5.00'), shippingLine(0.08, '2.00')])).toBeUndefined();
    expect(rateOf([shippingLine(0.23, '5.00'), { ...shippingLine(0.23, '0.00'), taxLines: [] }])).toBe('23');
  });

  it('should keep the buyer note verbatim', () => {
    expect(mapShopifyOrderToIncoming(order({ note: ' Please ring twice ' }), CTX).buyerNote).toBe('Please ring twice');
  });

  it('should report the OpenLinker order an order was created from, and only that', () => {
    expect(
      mapShopifyOrderToIncoming(order({ sourceIdentifier: 'ol_order_abc' }), CTX).createdFromInternalOrderId,
    ).toBe('ol_order_abc');
    expect(mapShopifyOrderToIncoming(order({ sourceIdentifier: 'POS-77' }), CTX).createdFromInternalOrderId).toBeUndefined();
    expect(mapShopifyOrderToIncoming(order(), CTX).createdFromInternalOrderId).toBeUndefined();
  });
});

describe('mapShopifyOrderStatus / mapShopifyPaymentStatus', () => {
  it.each([
    [{ cancelledAt: '2026-11-05T00:00:00Z' }, 'cancelled'],
    [{ displayFinancialStatus: 'REFUNDED' }, 'refunded'],
    [{ displayFulfillmentStatus: 'FULFILLED' }, 'shipped'],
    [{ displayFinancialStatus: 'PENDING' }, 'pending'],
  ])('should map %p to %p', (overrides, status) => {
    expect(mapShopifyOrderStatus(order(overrides as Partial<ShopifyOrder>))).toBe(status);
  });

  it('should leave an unknown financial status unasserted', () => {
    expect(mapShopifyPaymentStatus(order({ displayFinancialStatus: 'EXPIRED' }))).toBeUndefined();
  });
});

describe('shopifyTaxRateCode', () => {
  it('should state no rate for no tax line or two different rates, never a guess', () => {
    expect(shopifyTaxRateCode([])).toBeNull();
    expect(
      shopifyTaxRateCode([
        { title: 'a', rate: 0.04, ratePercentage: 4 },
        { title: 'b', rate: 0.045, ratePercentage: 4.5 },
      ]),
    ).toBeNull();
  });
});
