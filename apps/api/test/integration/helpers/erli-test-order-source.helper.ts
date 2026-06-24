/**
 * Erli Test OrderSource Harness Helper (#998)
 *
 * Registers a test-only `adapterKey='erli.ordersource.test.v1'` against the
 * running Nest app's `AdapterRegistryService` + `AdapterFactoryResolverService`,
 * with a factory that returns the REAL `ErliOrderSourceAdapter` wired to a fake
 * `IErliHttpClient`. Connections pointed at this adapterKey therefore resolve
 * through the same production path (`IntegrationsService.getCapabilityAdapter`)
 * real adapters use — so the adapter's inbox parsing, ack-on-next-read cursor
 * logic, `getOrder` wire-shape validation, the #994 mapper, and the #997
 * dispatch-writeback all execute, which is exactly the composition #998 must
 * verify (plan §3 / §5 Q2).
 *
 * Faking at the HTTP-transport seam (not the adapter seam) is the key decision
 * (mirrors the #991 offers harness): it keeps exactly the adapter logic under
 * test while the bearer credential stays closed over inside the real client in
 * production and never reaches this fake.
 *
 * The `ErliOrderSourceAdapter` ctor is `(connectionId, httpClient)` — no
 * `IdentifierMappingPort`, no cache (identity resolution is downstream in core,
 * #995). `connection.id` threads through so the adapter's per-connection log
 * scoping stays correct.
 *
 * Lifetime: suite-scoped. Call `installErliOrderSourceHarness(harness)` once in
 * `beforeAll`. `AdapterRegistryService.register` / `registerFactory` throw on a
 * duplicate adapterKey — intentional; the registration lives for the test
 * process's lifetime. The adapterKey is distinct from the #991 offers harness's
 * `erli.test.v1`, so both can coexist in the same process.
 *
 * @module apps/api/test/integration/helpers
 */
import type {
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ErliOrderSourceAdapter } from '@openlinker/integrations-erli/infrastructure/adapters/erli-order-source.adapter';

import type { IntegrationTestHarness } from '../setup';
import { ErliFakeHttpClient } from './erli-fake-http-client';

export const ERLI_ORDER_SOURCE_TEST_ADAPTER_KEY = 'erli.ordersource.test.v1';
export const ERLI_ORDER_SOURCE_TEST_PLATFORM_TYPE = 'erli';

export interface ErliOrderSourceHarness {
  /** The fake HTTP client backing the real adapter — script + assert against it. */
  readonly fake: ErliFakeHttpClient;
  readonly adapterKey: string;
  readonly platformType: string;
}

export function installErliOrderSourceHarness(
  harness: IntegrationTestHarness,
): ErliOrderSourceHarness {
  const app = harness.getApp();
  const adapterRegistry = app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = app.get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const fake = new ErliFakeHttpClient();

  adapterRegistry.register({
    adapterKey: ERLI_ORDER_SOURCE_TEST_ADAPTER_KEY,
    platformType: ERLI_ORDER_SOURCE_TEST_PLATFORM_TYPE,
    supportedCapabilities: ['OrderSource'],
    displayName: 'Erli OrderSource (integration-test, fake HTTP)',
    version: '0.0.0-test',
    // Explicit false so a future real `erli.shopapi.v1` stays the platform default.
    isDefault: false,
  });

  factoryResolver.registerFactory(ERLI_ORDER_SOURCE_TEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(connection: Connection): Promise<T> => {
      // REAL adapter — ctor is (connectionId, httpClient). No identifierMapping,
      // no cache (#995: identity resolution is downstream in core).
      const adapter = new ErliOrderSourceAdapter(connection.id, fake);
      return Promise.resolve(adapter as unknown as T);
    },
  });

  return {
    fake,
    adapterKey: ERLI_ORDER_SOURCE_TEST_ADAPTER_KEY,
    platformType: ERLI_ORDER_SOURCE_TEST_PLATFORM_TYPE,
  };
}
