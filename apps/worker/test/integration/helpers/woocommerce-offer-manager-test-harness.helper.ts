/**
 * WooCommerce OfferManager Test Harness Helper (#1498)
 *
 * Registers a test-only `adapterKey='woocommerce.test.v1'` against the
 * running Nest app's `AdapterRegistryService` + `AdapterFactoryResolverService`,
 * with a factory that returns the REAL `WooCommerceOfferManagerAdapter` wired
 * to a fake `IWooCommerceHttpClient`. Connections pointed at this adapterKey
 * therefore resolve through the same production path
 * (`IntegrationsService.getCapabilityAdapter` /
 * `IntegrationsService.listCapabilityAdapters`) real adapters use — mirrors
 * the Erli offers vertical-slice pattern (#991,
 * `erli-test-offer-manager.helper.ts`).
 *
 * Lifetime: suite-scoped. Call `installWooCommerceOfferManagerTestHarness(harness)`
 * once in `beforeAll`. `AdapterRegistryService.register` / `registerFactory`
 * throw on a duplicate adapterKey — intentional; the registration lives for
 * the test process's lifetime.
 *
 * @module apps/worker/test/integration/helpers
 */
import type {
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import { ADAPTER_FACTORY_RESOLVER_TOKEN, ADAPTER_REGISTRY_TOKEN } from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { WooCommerceOfferManagerAdapter } from '@openlinker/integrations-woocommerce/infrastructure/adapters/offer-manager/woocommerce-offer-manager.adapter';

import type { WorkerIntegrationTestHarness } from '../setup';
import { WooCommerceFakeHttpClient } from './woocommerce-fake-http-client';

export const WOOCOMMERCE_TEST_ADAPTER_KEY = 'woocommerce.test.v1';
export const WOOCOMMERCE_TEST_PLATFORM_TYPE = 'woocommerce';

export interface WooCommerceOfferManagerHarness {
  /** The fake HTTP client backing the real adapter — script + assert against it. */
  readonly fake: WooCommerceFakeHttpClient;
  readonly adapterKey: string;
  readonly platformType: string;
}

export function installWooCommerceOfferManagerTestHarness(
  harness: WorkerIntegrationTestHarness,
): WooCommerceOfferManagerHarness {
  const adapterRegistry = harness.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness.get<AdapterFactoryResolverService>(
    ADAPTER_FACTORY_RESOLVER_TOKEN,
  );

  const fake = new WooCommerceFakeHttpClient();

  adapterRegistry.register({
    adapterKey: WOOCOMMERCE_TEST_ADAPTER_KEY,
    platformType: WOOCOMMERCE_TEST_PLATFORM_TYPE,
    supportedCapabilities: ['OfferManager'],
    displayName: 'WooCommerce OfferManager (integration-test, fake HTTP)',
    version: '0.0.0-test',
    // Explicit false so the real `woocommerce.restapi.v3` stays the platform default.
    isDefault: false,
  });

  factoryResolver.registerFactory(WOOCOMMERCE_TEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(connection: Connection): Promise<T> => {
      const adapter = new WooCommerceOfferManagerAdapter(fake, connection);
      return Promise.resolve(adapter as unknown as T);
    },
  });

  return {
    fake,
    adapterKey: WOOCOMMERCE_TEST_ADAPTER_KEY,
    platformType: WOOCOMMERCE_TEST_PLATFORM_TYPE,
  };
}
