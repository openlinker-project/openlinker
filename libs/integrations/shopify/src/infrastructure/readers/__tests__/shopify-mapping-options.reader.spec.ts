import { ShopifyGraphqlError } from '../../../domain/exceptions/shopify-graphql.error';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { ShopifyMappingOptionsReader } from '../shopify-mapping-options.reader';

const PROFILES = {
  deliveryProfiles: {
    nodes: [
      {
        name: 'General',
        profileLocationGroups: [
          {
            locationGroupZones: {
              nodes: [
                {
                  zone: { name: 'Poland' },
                  methodDefinitions: {
                    nodes: [
                      { id: 'gid://shopify/DeliveryMethodDefinition/1', name: 'InPost Paczkomat', active: true },
                      { id: 'gid://shopify/DeliveryMethodDefinition/2', name: 'Old courier', active: false },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  },
};

const RECENT_ORDERS = {
  orders: {
    nodes: [
      {
        paymentGatewayNames: ['shopify_payments'],
        shippingLines: { nodes: [{ code: 'InPost Paczkomat', title: 'InPost Paczkomat' }] },
      },
      {
        paymentGatewayNames: ['Cash on Delivery (COD)'],
        shippingLines: { nodes: [{ code: 'custom-pickup', title: 'Pickup in store' }] },
      },
    ],
  },
};

function reader(query: jest.Mock): ShopifyMappingOptionsReader {
  return new ShopifyMappingOptionsReader({ query } as unknown as ShopifyGraphqlClient, 'c1');
}

describe('ShopifyMappingOptionsReader', () => {
  it('should list active delivery-profile methods with their zones, plus methods seen only on orders', async () => {
    const query = jest.fn().mockResolvedValueOnce(PROFILES).mockResolvedValueOnce(RECENT_ORDERS);

    const options = await reader(query).listDeliveryMethods();

    expect(options).toEqual([
      { value: 'InPost Paczkomat', label: 'InPost Paczkomat (Poland)' },
      { value: 'custom-pickup', label: 'Pickup in store (seen on orders, code custom-pickup)' },
    ]);
  });

  it('should fall back to methods seen on orders when the profiles cannot be read (no read_shipping)', async () => {
    const query = jest
      .fn()
      .mockRejectedValueOnce(new ShopifyGraphqlError(['ACCESS_DENIED'], ['Access denied for deliveryProfiles field']))
      .mockResolvedValueOnce(RECENT_ORDERS);

    const options = await reader(query).listDeliveryMethods();

    expect(options.map((o) => o.value)).toEqual(['InPost Paczkomat', 'custom-pickup']);
  });

  it('should list the built-in gateways plus the ones seen on orders, reading the orders once', async () => {
    const query = jest.fn().mockResolvedValueOnce(PROFILES).mockResolvedValueOnce(RECENT_ORDERS);
    const sut = reader(query);

    await sut.listDeliveryMethods();
    const payments = await sut.listPaymentMethods();

    expect(payments.map((o) => o.value)).toEqual(['manual', 'Cash on Delivery (COD)', 'Bank Deposit', 'shopify_payments']);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
