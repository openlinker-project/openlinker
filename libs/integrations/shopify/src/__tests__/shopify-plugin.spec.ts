import type { Connection } from '@openlinker/core/identifier-mapping';

import { createShopifyPlugin, shopifyAdapterManifest } from '../shopify-plugin';

describe('createShopifyPlugin', () => {
  it('should ship with no capability until each arrives with its adapter', () => {
    expect(shopifyAdapterManifest).toMatchObject({
      adapterKey: 'shopify.admin.v1',
      platformType: 'shopify',
      supportedCapabilities: [],
    });
    expect(createShopifyPlugin().manifest).toBe(shopifyAdapterManifest);
  });

  it('should share one rate-limit bucket per store', () => {
    expect(
      shopifyAdapterManifest.resolveRateLimitBucketKey?.({
        id: 'c1',
        config: { storeDomain: 'My-Shop.myshopify.com' },
      } as unknown as Connection),
    ).toBe('shopify:store:my-shop.myshopify.com');
  });

  it('should refuse any capability with the uniform not-supported error', async () => {
    await expect(
      createShopifyPlugin().createCapabilityAdapter({ id: 'c1' } as Connection, 'ProductMaster', {} as never),
    ).rejects.toThrow(/does not support capability: ProductMaster/);
  });
});
