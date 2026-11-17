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
    expect(order.totals.taxTreatment).toBeUndefined();
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
});
