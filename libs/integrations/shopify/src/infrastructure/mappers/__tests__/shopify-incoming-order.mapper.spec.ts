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
    discountedUnitPriceSet: money('24.90'),
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
    customer: { id: 'gid://shopify/Customer/5' },
    currentTotalPriceSet: money('60.75'),
    currentSubtotalPriceSet: money('49.80'),
    currentTotalTaxSet: money('11.36'),
    totalShippingPriceSet: money('10.95'),
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

  it('should keep the buyer note verbatim', () => {
    expect(mapShopifyOrderToIncoming(order({ note: ' Please ring twice ' }), CTX).buyerNote).toBe('Please ring twice');
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
