/**
 * Empik Test OrderSource Harness Helper (#4275)
 *
 * Registers a test-only adapter key against the running app's adapter
 * registry and factory resolver, with a factory that returns the REAL
 * `MiraklOrderSourceAdapter` over a `MiraklFakeHttpClient`. A connection
 * pointed at this key therefore resolves through the production path
 * (`IntegrationsService.getCapabilityAdapter`), and the adapter's acceptance,
 * window and mapping logic all run; only the transport is faked, so the API
 * key never reaches the test (the Erli #998 shape).
 *
 * The acceptance mode is read from the connection config exactly as the real
 * factory reads it.
 *
 * Suite-scoped: call once in `beforeAll`; the registry refuses a second
 * registration of the same key.
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
import { resolveMiraklOrderAcceptance } from '@openlinker/integrations-mirakl/domain/policies/mirakl-connection-config.policy';
import { MiraklOrderSourceAdapter } from '@openlinker/integrations-mirakl/infrastructure/adapters/mirakl-order-source.adapter';

import type { IntegrationTestHarness } from '../setup';
import { MiraklFakeHttpClient } from './mirakl-fake-http-client';

export const EMPIK_ORDER_SOURCE_TEST_ADAPTER_KEY = 'empik.ordersource.test.v1';
export const EMPIK_ORDER_SOURCE_TEST_PLATFORM_TYPE = 'empik';

export interface EmpikOrderSourceHarness {
  readonly fake: MiraklFakeHttpClient;
  readonly adapterKey: string;
  readonly platformType: string;
}

export function installEmpikOrderSourceHarness(
  harness: IntegrationTestHarness,
): EmpikOrderSourceHarness {
  const app = harness.getApp();
  const adapterRegistry = app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = app.get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);
  const fake = new MiraklFakeHttpClient();

  adapterRegistry.register({
    adapterKey: EMPIK_ORDER_SOURCE_TEST_ADAPTER_KEY,
    platformType: EMPIK_ORDER_SOURCE_TEST_PLATFORM_TYPE,
    supportedCapabilities: ['OrderSource'],
    displayName: 'Empik OrderSource (integration-test, fake HTTP)',
    version: '0.0.0-test',
    // The real `empik.mirakl.v1` stays the platform default.
    isDefault: false,
  });

  factoryResolver.registerFactory(EMPIK_ORDER_SOURCE_TEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(connection: Connection): Promise<T> => {
      const config = (connection.config ?? {}) as { orderAcceptance?: unknown };
      const adapter = new MiraklOrderSourceAdapter(
        connection.id,
        fake,
        resolveMiraklOrderAcceptance(config.orderAcceptance),
      );
      return Promise.resolve(adapter as unknown as T);
    },
  });

  return {
    fake,
    adapterKey: EMPIK_ORDER_SOURCE_TEST_ADAPTER_KEY,
    platformType: EMPIK_ORDER_SOURCE_TEST_PLATFORM_TYPE,
  };
}
