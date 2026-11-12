import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  isBulkProductReader,
  isModifiedProductLister,
  isProductTaxRateReader,
  type ProductMasterPort,
  type ProductTaxRateReader,
} from '@openlinker/core/products';

import { createShopifyPlugin, shopifyAdapterManifest } from '../shopify-plugin';

describe('createShopifyPlugin', () => {
  it('should advertise ProductMaster and enable only it by default', () => {
    expect(shopifyAdapterManifest).toMatchObject({
      adapterKey: 'shopify.admin.v1',
      platformType: 'shopify',
      supportedCapabilities: ['ProductMaster'],
      defaultEnabledCapabilities: ['ProductMaster'],
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

  it('should refuse a capability it has no adapter for, before resolving anything', async () => {
    await expect(
      createShopifyPlugin().createCapabilityAdapter({ id: 'c1' } as Connection, 'OrderSource', {} as never),
    ).rejects.toThrow(/does not support capability: OrderSource/);
  });

  it('should build the ProductMaster with every guard-only rung', async () => {
    const host = {
      credentialsResolver: { get: jest.fn().mockResolvedValue({ accessToken: 'shpat_x' }) },
      http: { forConnection: jest.fn().mockReturnValue(jest.fn()) },
      identifierMapping: {},
      cache: undefined,
    };
    const connection = {
      id: 'c1',
      credentialsRef: 'db:ref',
      config: { storeDomain: 'my-shop.myshopify.com' },
    } as unknown as Connection;

    const adapter = await createShopifyPlugin().createCapabilityAdapter<ProductMasterPort>(
      connection,
      'ProductMaster',
      host as never,
    );

    expect(isModifiedProductLister(adapter)).toBe(true);
    expect(isBulkProductReader(adapter)).toBe(true);
    expect(isProductTaxRateReader(adapter)).toBe(true);
    expect((adapter as Partial<ProductTaxRateReader>).readsTaxRatePerVariant).toBeUndefined();
  });
});
