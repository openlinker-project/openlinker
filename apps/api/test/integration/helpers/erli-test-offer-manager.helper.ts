/**
 * Erli Test OfferManager Harness Helper (#991)
 *
 * Registers a test-only `adapterKey='erli.test.v1'` against the running Nest
 * app's `AdapterRegistryService` + `AdapterFactoryResolverService`, with a
 * factory that returns the REAL `ErliOfferManagerAdapter` wired to a fake
 * `IErliHttpClient` (and the harness's live `CachePort`). Connections pointed
 * at this adapterKey therefore resolve through the same production path
 * (`IntegrationsService.getCapabilityAdapter`) real adapters use — and the
 * adapter's create-body building, sparse PATCH, frozen-field suppression,
 * variant-group emission, frozen-stock cache, and status mapping all execute
 * (plan §3 / §5 Phase 2).
 *
 * Faking at the HTTP seam (not the adapter seam) is the key decision: it keeps
 * exactly the adapter logic #991 must verify under test. The frozen-stock cache
 * key is connection-scoped, so the factory threads `connection.id` from the
 * resolver's `connection` arg into the adapter ctor — a wrong wiring would make
 * the key cross-tenant-ambiguous.
 *
 * Lifetime: suite-scoped. Call `installErliOffersHarness(harness)` once in
 * `beforeAll`. `AdapterRegistryService.register` / `registerFactory` throw on a
 * duplicate adapterKey — intentional; the registration lives for the test
 * process's lifetime.
 *
 * @module apps/api/test/integration/helpers
 */
import type {
  AdapterFactoryResolverService,
  AdapterRegistryPort} from '@openlinker/core/integrations';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { CACHE_PORT_TOKEN, type CachePort } from '@openlinker/shared';
import { ErliOfferManagerAdapter } from '@openlinker/integrations-erli/infrastructure/adapters/erli-offer-manager.adapter';

import type { IntegrationTestHarness } from '../setup';
import { ErliFakeHttpClient } from './erli-fake-http-client';

export const ERLI_TEST_ADAPTER_KEY = 'erli.test.v1';
export const ERLI_TEST_PLATFORM_TYPE = 'erli';

export interface ErliOffersHarness {
  /** The fake HTTP client backing the real adapter — script + assert against it. */
  readonly fake: ErliFakeHttpClient;
  readonly adapterKey: string;
  readonly platformType: string;
}

export function installErliOffersHarness(harness: IntegrationTestHarness): ErliOffersHarness {
  const app = harness.getApp();
  const adapterRegistry = app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = app.get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);
  // Live Redis-backed cache from the harness so the frozen-stock flag round-trips.
  const cachePort = app.get<CachePort>(CACHE_PORT_TOKEN);

  const fake = new ErliFakeHttpClient();

  adapterRegistry.register({
    adapterKey: ERLI_TEST_ADAPTER_KEY,
    platformType: ERLI_TEST_PLATFORM_TYPE,
    supportedCapabilities: ['OfferManager'],
    displayName: 'Erli OfferManager (integration-test, fake HTTP)',
    version: '0.0.0-test',
    // Explicit false so a future real `erli.shopapi.v1` stays the platform default.
    isDefault: false,
  });

  factoryResolver.registerFactory(ERLI_TEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(connection: Connection): Promise<T> => {
      // REAL adapter — ctor is
      // (connectionId, adapterKey, httpClient, defaultDispatchTime?, cache?).
      // `identifierMapping` is intentionally NOT a ctor arg. `connection.id`
      // tenant-scopes the frozen-stock cache key. A real default dispatch time
      // is required (creates fail closed without one); `cachePort` MUST be the
      // 5th arg so the frozen-stock flag round-trips — passing it 4th would land
      // it in `defaultDispatchTime` and leave the cache `undefined` (every
      // consult fails open), silently nullifying the #1066 coverage.
      const adapter = new ErliOfferManagerAdapter(
        connection.id,
        ERLI_TEST_ADAPTER_KEY,
        fake,
        { period: 2, unit: 'day' },
        cachePort,
      );
      return Promise.resolve(adapter as unknown as T);
    },
  });

  return {
    fake,
    adapterKey: ERLI_TEST_ADAPTER_KEY,
    platformType: ERLI_TEST_PLATFORM_TYPE,
  };
}
