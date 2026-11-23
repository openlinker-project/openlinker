/**
 * Shopify plugin - API host boot (#3974, #4100 review)
 *
 * The plugin is composed into `apiPlugins`, and `ShopifyIntegrationModule` is
 * hand-written rather than built with `createNestAdapterModule` (it injects the
 * credentials writer, the lock, `ConnectionPort`, the webhook-secret service
 * and the archive-hook registry). A DI or registry mistake there shows only
 * when the real container boots, so this file boots the real API container and
 * reads every registration the plugin makes back out of the registries the
 * host serves requests from.
 *
 * No stub is registered: every assertion is about what the plugin itself put
 * into the container.
 *
 * @module apps/api/test/integration
 */
import type {
  AdapterMetadata,
  ConnectionArchiveHookRegistryService,
  ConnectionTesterRegistryService,
  InboundWebhookDecoderRegistryService,
  WebhookEventTranslatorRegistryService,
  WebhookProvisioningRegistryService,
} from '@openlinker/core/integrations';
import {
  ADAPTER_REGISTRY_TOKEN,
  CONNECTION_ARCHIVE_HOOK_REGISTRY_TOKEN,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN,
  WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import type {
  AuthFailureClassifierRegistryService,
  RetryClassifierRegistryService,
} from '@openlinker/core/sync';
import {
  AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN,
  RETRY_CLASSIFIER_REGISTRY_TOKEN,
} from '@openlinker/core/sync';
import { SHOPIFY_ADAPTER_KEY, SHOPIFY_PLATFORM_TYPE } from '@openlinker/integrations-shopify';

import { getTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

describe('Shopify plugin - API host boot (#3974)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function get<T>(token: symbol): T {
    return harness.getApp().get<T>(token, { strict: false });
  }

  it('should register the Shopify manifest in the adapter registry', async () => {
    const adapters = await get<{ listAdapters: () => Promise<AdapterMetadata[]> }>(
      ADAPTER_REGISTRY_TOKEN
    ).listAdapters();
    const shopify = adapters.find((adapter) => adapter.adapterKey === SHOPIFY_ADAPTER_KEY);

    expect(shopify).toBeDefined();
    expect(shopify?.platformType).toBe(SHOPIFY_PLATFORM_TYPE);
    expect(shopify?.supportedCapabilities).toEqual(
      expect.arrayContaining(['ProductMaster', 'InventoryMaster', 'OrderSource'])
    );
  });

  it('should register the webhook decoder, translator and provisioner', () => {
    // The decoder is keyed by platform type (the `:provider` route segment),
    // the translator and the provisioner by adapter key.
    expect(
      get<InboundWebhookDecoderRegistryService>(INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN).has(
        SHOPIFY_PLATFORM_TYPE
      )
    ).toBe(true);
    expect(
      get<WebhookEventTranslatorRegistryService>(WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN).has(
        SHOPIFY_ADAPTER_KEY
      )
    ).toBe(true);
    expect(
      get<WebhookProvisioningRegistryService>(WEBHOOK_PROVISIONING_REGISTRY_TOKEN).has(
        SHOPIFY_ADAPTER_KEY
      )
    ).toBe(true);
  });

  it('should register the connection tester, the classifiers and the archive hook', () => {
    expect(
      get<ConnectionTesterRegistryService>(CONNECTION_TESTER_REGISTRY_TOKEN).has(
        SHOPIFY_ADAPTER_KEY
      )
    ).toBe(true);
    expect(
      get<RetryClassifierRegistryService>(RETRY_CLASSIFIER_REGISTRY_TOKEN).has(SHOPIFY_ADAPTER_KEY)
    ).toBe(true);
    expect(
      get<AuthFailureClassifierRegistryService>(AUTH_FAILURE_CLASSIFIER_REGISTRY_TOKEN).has(
        SHOPIFY_ADAPTER_KEY
      )
    ).toBe(true);
    expect(
      get<ConnectionArchiveHookRegistryService>(CONNECTION_ARCHIVE_HOOK_REGISTRY_TOKEN).get(
        SHOPIFY_ADAPTER_KEY
      )
    ).toBeDefined();
  });
});
