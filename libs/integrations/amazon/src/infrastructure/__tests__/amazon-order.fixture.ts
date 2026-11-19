/**
 * Amazon order fixture, shaped after the Orders API v2026-01-01 model.
 *
 * @module libs/integrations/amazon/src/infrastructure/__tests__
 */
import type { AmazonOrder } from '../../domain/types/amazon-order.types';

const eur = (amount: string): { amount: string; currencyCode: string } => ({ amount, currencyCode: 'EUR' });

export function amazonFbmOrder(overrides: Partial<AmazonOrder> = {}): AmazonOrder {
  return {
    orderId: '302-1234567-7654321',
    createdTime: '2026-11-16T09:00:00Z',
    lastUpdatedTime: '2026-11-16T09:05:00Z',
    salesChannel: { channelName: 'AMAZON', marketplaceId: 'A1PA6795UKMFR9', marketplaceName: 'Amazon.de' },
    buyer: { buyerName: 'Anna Schmidt', buyerEmail: 'abc123@marketplace.amazon.de' },
    recipient: {
      deliveryAddress: {
        name: 'Anna Maria Schmidt',
        addressLine1: 'Hauptstrasse 1',
        addressLine2: 'Hinterhaus',
        city: 'Berlin',
        postalCode: '10115',
        countryCode: 'DE',
        phone: '+49 30 123456',
      },
    },
    proceeds: {
      grandTotal: eur('64.89'),
      breakdowns: [
        { type: 'ITEM', subtotal: eur('59.90') },
        { type: 'SHIPPING', subtotal: eur('4.99') },
        { type: 'TAX', subtotal: eur('10.36') },
      ],
    },
    payment: { paymentExecutions: [{ paymentMethod: 'CreditCard', paymentAmount: eur('64.89') }] },
    fulfillment: {
      fulfillmentStatus: 'UNSHIPPED',
      fulfilledBy: 'MERCHANT',
      fulfillmentServiceLevel: 'STANDARD',
      shipByWindow: { earliestDateTime: '2026-11-16T09:00:00Z', latestDateTime: '2026-11-18T22:59:59Z' },
      deliverByWindow: { latestDateTime: '2026-11-21T22:59:59Z' },
    },
    orderItems: [
      {
        orderItemId: '11111111111111',
        quantityOrdered: 2,
        product: { asin: 'B0ABCDEFGH', title: 'Mug, blue', sellerSku: 'MUG-BLUE', price: { unitPrice: eur('19.95') } },
      },
      {
        orderItemId: '22222222222222',
        quantityOrdered: 1,
        product: { asin: 'B0ZZZZZZZZ', title: 'Coaster', price: { unitPrice: eur('20.00') } },
      },
    ],
    ...overrides,
  };
}
