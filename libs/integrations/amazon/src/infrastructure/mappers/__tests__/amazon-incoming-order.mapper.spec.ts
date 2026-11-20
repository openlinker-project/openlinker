/**
 * mapAmazonOrderToIncomingOrder tests (#4178)
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers/__tests__
 */
import { amazonFbmOrder } from '../../__tests__/amazon-order.fixture';
import { mapAmazonOrderToIncomingOrder } from '../amazon-incoming-order.mapper';

describe('mapAmazonOrderToIncomingOrder', () => {
  it('should map an FBM order with lines, totals and the buyer address', () => {
    const order = mapAmazonOrderToIncomingOrder(amazonFbmOrder());

    expect(order).toMatchObject({
      externalOrderId: '302-1234567-7654321',
      orderNumber: '302-1234567-7654321',
      status: 'processing',
      customerEmail: 'abc123@marketplace.amazon.de',
      paymentStatus: 'paid',
      paymentMethod: 'online',
      sourcePaymentMethod: 'CreditCard',
      shipping: { methodId: 'STANDARD', methodName: 'STANDARD' },
      dispatchTime: { from: '2026-11-16T09:00:00Z', to: '2026-11-18T22:59:59Z' },
      placedAt: '2026-11-16T09:00:00Z',
      totals: { subtotal: 59.9, shipping: 4.99, tax: 10.36, total: 64.89, currency: 'EUR', totalTaxTreatment: 'inclusive' },
      shippingAddress: {
        firstName: 'Anna Maria',
        lastName: 'Schmidt',
        address1: 'Hauptstrasse 1',
        address2: 'Hinterhaus',
        city: 'Berlin',
        postalCode: '10115',
        country: 'DE',
      },
      metadata: { amazonMarketplaceId: 'A1PA6795UKMFR9', amazonShippingAddressWithheld: false },
    });
    expect(order.fulfilledBySource).toBeUndefined();
    // ITEM 59.90 + SHIPPING 4.99 = 64.89 = grandTotal, so TAX 10.36 is inside the prices.
    expect(order.totals.taxTreatment).toBe('inclusive');
    expect(order.totals.shippingGross).toBeUndefined();
  });

  it('should key a line by seller SKU, and by ASIN when there is none', () => {
    const [mug, coaster] = mapAmazonOrderToIncomingOrder(amazonFbmOrder()).items;
    expect(mug).toMatchObject({ id: '11111111111111', productRef: { type: 'sku', externalId: 'MUG-BLUE' }, sku: 'MUG-BLUE', quantity: 2, price: 19.95 });
    expect(coaster.productRef).toEqual({ type: 'offer', externalId: 'B0ZZZZZZZZ' });
    expect(coaster.taxRate).toBeUndefined();
  });

  it('should say the address was withheld when Amazon sends none', () => {
    const order = mapAmazonOrderToIncomingOrder(amazonFbmOrder({ recipient: undefined }));
    expect(order.shippingAddress).toBeUndefined();
    expect(order.metadata).toMatchObject({ amazonShippingAddressWithheld: true });
  });

  it('should mark an order Amazon ships itself as fulfilled by the source', () => {
    const order = mapAmazonOrderToIncomingOrder(
      amazonFbmOrder({ fulfillment: { fulfillmentStatus: 'UNSHIPPED', fulfilledBy: 'AMAZON' } }),
    );
    expect(order.fulfilledBySource).toBe(true);
  });

  it('should read cash on delivery with the amount to collect', () => {
    const order = mapAmazonOrderToIncomingOrder(
      amazonFbmOrder({ payment: { paymentExecutions: [{ paymentMethod: 'CashOnDelivery' }] } }),
    );
    expect(order).toMatchObject({
      paymentMethod: 'cash_on_delivery',
      paymentStatus: 'cod',
      codToCollect: { amount: '64.89', currency: 'EUR' },
    });
  });

  it.each([
    ['PENDING', 'pending', 'awaiting'],
    ['CANCELLED', 'cancelled', 'paid'],
    ['SHIPPED', 'shipped', 'paid'],
  ])('should map %s to %s', (fulfillmentStatus, status, paymentStatus) => {
    const order = mapAmazonOrderToIncomingOrder(amazonFbmOrder({ fulfillment: { fulfillmentStatus } }));
    expect(order).toMatchObject({ status, paymentStatus });
  });

  it('should read a shipped order whose every package is delivered as delivered', () => {
    const order = mapAmazonOrderToIncomingOrder(
      amazonFbmOrder({
        fulfillment: { fulfillmentStatus: 'SHIPPED' },
        packages: [{ packageReferenceId: 'p1', packageStatus: { status: 'DELIVERED' } }],
      }),
    );
    expect(order.status).toBe('delivered');
  });

  it('should carry a B2B tax registration onto the addresses', () => {
    const order = mapAmazonOrderToIncomingOrder(
      amazonFbmOrder({
        tax: {
          taxRegistrations: [
            {
              taxRegistrationNumber: ' DE123456789 ',
              taxRegistrationAddress: { name: 'ACME GmbH', addressLine1: 'Weg 2', city: 'Hamburg', postalCode: '20095', countryCode: 'DE' },
            },
          ],
        },
      }),
    );
    expect(order.shippingAddress?.taxId).toBe('DE123456789');
    expect(order.billingAddress).toMatchObject({ address1: 'Weg 2', city: 'Hamburg', taxId: 'DE123456789' });
  });

  describe('money', () => {
    const usd = (amount: string): { amount: string; currencyCode: string } => ({ amount, currencyCode: 'USD' });
    const eur = (amount: string): { amount: string; currencyCode: string } => ({ amount, currencyCode: 'EUR' });

    it('should read a US order whose sales tax is added on top as net prices with gross beside them', () => {
      // Amazon's own sandbox example 114-9876543-1234567 (Orders API v2026-01-01).
      const order = mapAmazonOrderToIncomingOrder(
        amazonFbmOrder({
          salesChannel: { channelName: 'AMAZON', marketplaceId: 'ATVPDKIKX0DER' },
          proceeds: { grandTotal: usd('49.99') },
          orderItems: [
            {
              orderItemId: '11498765431234',
              quantityOrdered: 1,
              product: { asin: 'B0BSHF7WHW', sellerSku: 'ECHO-POP-US-BLK', price: { unitPrice: usd('39.99') } },
              proceeds: {
                proceedsTotal: usd('49.99'),
                breakdowns: [
                  { type: 'ITEM', subtotal: usd('39.99') },
                  { type: 'TAX', subtotal: usd('10.00') },
                ],
              },
            },
          ],
        }),
      );

      expect(order.totals).toMatchObject({
        subtotal: 39.99,
        shipping: 0,
        shippingGross: 0,
        tax: 10,
        total: 49.99,
        currency: 'USD',
        taxTreatment: 'exclusive',
        totalTaxTreatment: 'inclusive',
      });
      expect(order.items[0]).toMatchObject({ price: 39.99, unitPriceGross: 49.99 });
    });

    it('should split tax and discounts between the item and its shipping when Amazon details them', () => {
      const order = mapAmazonOrderToIncomingOrder(
        amazonFbmOrder({
          proceeds: { grandTotal: usd('99.00') },
          orderItems: [
            {
              orderItemId: '1',
              quantityOrdered: 2,
              product: { sellerSku: 'A', price: { unitPrice: usd('45.00') } },
              proceeds: {
                breakdowns: [
                  { type: 'ITEM', subtotal: usd('90.00') },
                  { type: 'SHIPPING', subtotal: usd('6.00') },
                  {
                    type: 'DISCOUNT',
                    subtotal: usd('-5.00'),
                    detailedBreakdowns: [
                      { subtype: 'ITEM', value: usd('-4.00') },
                      { subtype: 'SHIPPING', value: usd('-1.00') },
                    ],
                  },
                  {
                    type: 'TAX',
                    subtotal: usd('8.00'),
                    detailedBreakdowns: [
                      { subtype: 'ITEM', value: usd('7.50') },
                      { subtype: 'SHIPPING', value: usd('0.50') },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      );

      // 86 + 5 + 8 = 99: net prices with tax added.
      expect(order.totals).toMatchObject({ subtotal: 86, shipping: 5, shippingGross: 5.5, tax: 8, taxTreatment: 'exclusive' });
      expect(order.items[0]).toMatchObject({ quantity: 2, price: 43, unitPriceGross: 46.75 });
    });

    it('should read European item proceeds as gross prices, net of the discount', () => {
      const order = mapAmazonOrderToIncomingOrder(
        amazonFbmOrder({
          proceeds: { grandTotal: eur('115.00') },
          orderItems: [
            {
              orderItemId: '1',
              quantityOrdered: 1,
              product: { sellerSku: 'A', price: { unitPrice: eur('123.00') } },
              proceeds: {
                breakdowns: [
                  { type: 'ITEM', subtotal: eur('123.00') },
                  { type: 'SHIPPING', subtotal: eur('2.00') },
                  { type: 'DISCOUNT', subtotal: eur('-10.00') },
                  { type: 'TAX', subtotal: eur('21.50') },
                ],
              },
            },
          ],
        }),
      );

      expect(order.totals).toMatchObject({ subtotal: 113, shipping: 2, tax: 21.5, total: 115, taxTreatment: 'inclusive' });
      expect(order.items[0]).toMatchObject({ price: 113, unitPriceGross: 113 });
    });

    it('should assert nothing about tax when the amounts agree with neither reading', () => {
      const order = mapAmazonOrderToIncomingOrder(
        amazonFbmOrder({
          proceeds: { grandTotal: eur('70.00') },
          orderItems: [
            {
              orderItemId: '1',
              quantityOrdered: 1,
              product: { sellerSku: 'A', price: { unitPrice: eur('50.00') } },
              proceeds: {
                breakdowns: [
                  { type: 'ITEM', subtotal: eur('50.00') },
                  { type: 'TAX', subtotal: eur('9.35') },
                ],
              },
            },
          ],
        }),
      );

      expect(order.totals.taxTreatment).toBeUndefined();
      expect(order.totals.totalTaxTreatment).toBe('inclusive');
      expect(order.items[0]).toMatchObject({ price: 50, unitPriceGross: 50 });
    });

    it('should carry gift wrap, a COD fee and a delivery tip in shipping so lines and shipping add up to the total', () => {
      const order = mapAmazonOrderToIncomingOrder(
        amazonFbmOrder({
          proceeds: {
            grandTotal: eur('41.00'),
            breakdowns: [{ type: 'DELIVERY_TIP', subtotal: eur('2.00') }],
          },
          orderItems: [
            {
              orderItemId: '1',
              quantityOrdered: 1,
              product: { sellerSku: 'A', price: { unitPrice: eur('30.00') } },
              proceeds: {
                breakdowns: [
                  { type: 'ITEM', subtotal: eur('30.00') },
                  { type: 'SHIPPING', subtotal: eur('4.00') },
                  { type: 'GIFT_WRAP', subtotal: eur('2.00') },
                  { type: 'COD_FEE', subtotal: eur('3.00') },
                  { type: 'TAX', subtotal: eur('6.55') },
                ],
              },
            },
          ],
        }),
      );

      expect(order.totals).toMatchObject({ subtotal: 30, shipping: 11, total: 41, taxTreatment: 'inclusive' });
    });

    it('should spread order-level tax over the lines by value when items carry no breakdown', () => {
      const order = mapAmazonOrderToIncomingOrder(
        amazonFbmOrder({
          proceeds: {
            grandTotal: usd('66.00'),
            breakdowns: [
              { type: 'ITEM', subtotal: usd('60.00') },
              { type: 'TAX', subtotal: usd('6.00') },
            ],
          },
          orderItems: [
            { orderItemId: '1', quantityOrdered: 1, product: { sellerSku: 'A', price: { unitPrice: usd('40.00') } } },
            { orderItemId: '2', quantityOrdered: 2, product: { sellerSku: 'B', price: { unitPrice: usd('10.00') } } },
          ],
        }),
      );

      expect(order.totals).toMatchObject({ subtotal: 60, tax: 6, taxTreatment: 'exclusive' });
      expect(order.items.map((item) => [item.price, item.unitPriceGross])).toEqual([
        [40, 44],
        [10, 11],
      ]);
    });
  });
});
