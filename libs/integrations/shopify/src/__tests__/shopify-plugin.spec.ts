import type { Connection } from '@openlinker/core/identifier-mapping';
import { isBulkInventoryReader, type InventoryMasterPort } from '@openlinker/core/inventory';
import {
  isBulkProductReader,
  isModifiedProductLister,
  isProductTaxRateReader,
  type ProductMasterPort,
  type ProductTaxRateReader,
} from '@openlinker/core/products';

import { isDestinationOptionsReader, type OrderProcessorManagerPort } from '@openlinker/core/orders';

import type { HostServices } from '@openlinker/plugin-sdk';

import { ShopifyInboundWebhookDecoderAdapter } from '../infrastructure/adapters/webhooks/shopify-inbound-webhook-decoder.adapter';
import { ShopifyWebhookEventTranslatorAdapter } from '../infrastructure/adapters/webhooks/shopify-webhook-event-translator.adapter';
import { createShopifyPlugin, shopifyAdapterManifest } from '../shopify-plugin';

describe('createShopifyPlugin', () => {
  it('should advertise its capabilities and enable only the two masters by default', () => {
    expect(shopifyAdapterManifest).toMatchObject({
      adapterKey: 'shopify.admin.v1',
      platformType: 'shopify',
      supportedCapabilities: [
        'ProductMaster',
        'InventoryMaster',
        'OrderSource',
        'OrderProcessorManager',
        'ProductPublisher',
        'CategoryProvisioner',
        'ReturnSourceReader',
        'ReturnDecliner',
        'ShopCategoryBrowser',
        'ShopAttributeReader',
      ],
      // OrderSource and OrderProcessorManager are opt-in: one sends the store's
      // orders to every destination, the other brings every marketplace order in.
      defaultEnabledCapabilities: ['ProductMaster', 'InventoryMaster'],
    });
    expect(createShopifyPlugin().manifest).toBe(shopifyAdapterManifest);
  });

  it('should register the webhook decoder by platform type and the translator by adapter key', () => {
    const registry = (): { register: jest.Mock } => ({ register: jest.fn() });
    const host = {
      connectionTesterRegistry: registry(),
      connectionConfigShapeValidatorRegistry: registry(),
      connectionCredentialsShapeValidatorRegistry: registry(),
      authFailureClassifierRegistry: registry(),
      retryClassifierRegistry: registry(),
      oauthCompletionRegistry: registry(),
      schedulerTaskRegistry: registry(),
      inboundWebhookDecoderRegistry: registry(),
      webhookEventTranslatorRegistry: registry(),
    };

    createShopifyPlugin().register?.(host as unknown as HostServices);

    expect(host.inboundWebhookDecoderRegistry.register).toHaveBeenCalledWith(
      'shopify',
      expect.any(ShopifyInboundWebhookDecoderAdapter),
    );
    expect(host.webhookEventTranslatorRegistry.register).toHaveBeenCalledWith(
      'shopify.admin.v1',
      expect.any(ShopifyWebhookEventTranslatorAdapter),
    );
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
      createShopifyPlugin().createCapabilityAdapter({ id: 'c1' } as Connection, 'OfferManager', {} as never),
    ).rejects.toThrow(/does not support capability: OfferManager/);
  });

  it('should build the order processor', async () => {
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

    const adapter = await createShopifyPlugin().createCapabilityAdapter<OrderProcessorManagerPort>(
      connection,
      'OrderProcessorManager',
      host as never,
    );

    expect(typeof adapter.createOrder).toBe('function');
    expect(isDestinationOptionsReader(adapter)).toBe(true);
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
