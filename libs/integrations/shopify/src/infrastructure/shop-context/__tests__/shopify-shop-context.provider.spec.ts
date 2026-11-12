import type { CachePort } from '@openlinker/shared';

import { ShopifyConfigException } from '../../../domain/exceptions/shopify-config.exception';
import type { ShopifyGraphqlClient } from '../../http/shopify-graphql-client';
import { ShopifyShopContextProvider } from '../shopify-shop-context.provider';

const DATA = {
  shop: { id: 'gid://shopify/Shop/1', name: 'Dev', myshopifyDomain: 'd.myshopify.com', currencyCode: 'PLN', taxesIncluded: true },
  location: { id: 'gid://shopify/Location/1', name: 'Main', isActive: true },
  locations: {
    nodes: [
      { id: 'gid://shopify/Location/1', name: 'Main', isActive: true },
      { id: 'gid://shopify/Location/2', name: 'Closed', isActive: false },
    ],
  },
};

function client(data: unknown = DATA): ShopifyGraphqlClient {
  return { query: jest.fn().mockResolvedValue(data) } as unknown as ShopifyGraphqlClient;
}

describe('ShopifyShopContextProvider', () => {
  it('should resolve the primary location when none is configured', async () => {
    await expect(new ShopifyShopContextProvider(client(), 'c1', null, undefined).get()).resolves.toEqual({
      shopName: 'Dev',
      currencyCode: 'PLN',
      taxesIncluded: true,
      locationGid: 'gid://shopify/Location/1',
      locationName: 'Main',
    });
  });

  it.each([
    ['unknown', 'gid://shopify/Location/9'],
    ['inactive', 'gid://shopify/Location/2'],
  ])('should refuse an %s configured location naming locationId', async (_label, gid) => {
    const error = await new ShopifyShopContextProvider(client(), 'c1', gid, undefined).get().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShopifyConfigException);
    expect(error).toMatchObject({ field: 'locationId' });
  });

  it('should ignore a cached context resolved for another configured location', async () => {
    const cache = {
      get: jest.fn().mockResolvedValue({
        shopName: 'Dev',
        currencyCode: 'PLN',
        taxesIncluded: true,
        locationGid: 'gid://shopify/Location/1',
        locationName: 'Main',
        configuredLocationGid: null,
      }),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn(),
    } as unknown as CachePort;
    const graphql = client();

    await expect(
      new ShopifyShopContextProvider(graphql, 'c1', 'gid://shopify/Location/9', cache).get(),
    ).rejects.toBeInstanceOf(ShopifyConfigException);
    expect(graphql.query).toHaveBeenCalled();
  });
});
