import type { Connection } from '@openlinker/core/identifier-mapping';
import { isBulkInventoryReader, type InventoryMasterPort } from '@openlinker/core/inventory';
import {
  isBulkProductReader,
  isModifiedProductLister,
  isProductTaxRateReader,
  type ProductMasterPort,
  type ProductTaxRateReader,
} from '@openlinker/core/products';

import { createShopifyPlugin, shopifyAdapterManifest } from '../shopify-plugin';

describe('createShopifyPlugin', () => {
  it('should advertise and enable by default the two master capabilities', () => {
    expect(shopifyAdapterManifest).toMatchObject({
      adapterKey: 'shopify.admin.v1',
      platformType: 'shopify',
      supportedCapabilities: ['ProductMaster', 'InventoryMaster'],
      defaultEnabledCapabilities: ['ProductMaster', 'InventoryMaster'],
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

  it('should build the InventoryMaster with the bulk inventory rung', async () => {
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

    const adapter = await createShopifyPlugin().createCapabilityAdapter<InventoryMasterPort>(
      connection,
      'InventoryMaster',
      host as never,
    );

    expect(isBulkInventoryReader(adapter)).toBe(true);
  });
});
