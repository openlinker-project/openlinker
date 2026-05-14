/**
 * Allegro Test OrderSourcePort Stub Helper (#535)
 *
 * Registers a synthetic `allegro.test.v1` adapter with the running Nest
 * application's `AdapterRegistryService` + `AdapterFactoryResolverService`
 * — the same public plugin seam real integrations use (#570 / #574).
 *
 * Why the registry seam instead of monkey-patching `IntegrationsService`:
 * the carrier-mapping spec wants to short-circuit the Allegro side of the
 * pipeline without spinning up the real Allegro OAuth/HTTP plumbing. Two
 * paths were considered during planning:
 *
 *   1. Monkey-patch `IntegrationsService.getCapabilityAdapter` to return
 *      the stub. Quick but bypasses the production resolution chain —
 *      makes the spec less honest about what wiring is actually exercised.
 *   2. Register a test-only `adapterKey='allegro.test.v1'` with the
 *      registry + factory resolver, then create the Allegro test connection
 *      with that explicit `adapterKey`. Same resolution path as production,
 *      no internal-method patching, cast lives in one place (the factory
 *      closure). This is the path the helper takes.
 *
 * Lifetime: suite-scoped. Call `installAllegroTestSourceStub(harness)` once
 * in `beforeAll`. `AdapterRegistryService.register` throws
 * `DuplicateAdapterKeyException` on a second call for the same adapterKey —
 * intentional; the stub lives for the lifetime of the Nest process under test.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import type {
  IncomingOrder,
  OrderFeedInput,
  OrderFeedOutput,
  OrderSourcePort,
} from '@openlinker/core/orders';
import type { IntegrationTestHarness } from '../setup';
// Importing the concrete class is intentional: it's the host-side resolver
// service, not a port a plugin would consume. There is no `AdapterFactoryResolverPort`
// in the public surface today, so the test reaches into the same Nest provider
// the IntegrationsService itself depends on.
import { AdapterFactoryResolverService } from '@openlinker/core/integrations';

export const ALLEGRO_TEST_ADAPTER_KEY = 'allegro.test.v1';
export const ALLEGRO_TEST_PLATFORM_TYPE = 'allegro';

export interface AllegroTestSourceStub {
  /** AdapterKey the test connection must set explicitly. */
  readonly adapterKey: string;
  /** PlatformType reused from production (`'allegro'`) — `isDefault: false` keeps the real default intact. */
  readonly platformType: string;
  /**
   * Set the `IncomingOrder` the stub will return on the next `getOrder` call
   * whose `externalOrderId` matches `incoming.externalOrderId`.
   *
   * Keyed by externalOrderId so multiple scenarios in the same suite stay
   * isolated — S-1 and S-2 each call this once with their distinct order id.
   */
  setNextIncomingOrder(incoming: IncomingOrder): void;
}

export function installAllegroTestSourceStub(
  harness: IntegrationTestHarness
): AllegroTestSourceStub {
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const orderStore = new Map<string, IncomingOrder>();

  const orderSourceStub: OrderSourcePort = {
    listOrderFeed(_input: OrderFeedInput): Promise<OrderFeedOutput> {
      // This spec drives ingestion via direct `syncOrderFromSource` calls,
      // never via cursor-based polling. Returning empty + no next cursor
      // keeps the contract honest for any caller that does poll.
      return Promise.resolve({ items: [], nextCursor: null });
    },
    getOrder({ externalOrderId }): Promise<IncomingOrder> {
      const incoming = orderStore.get(externalOrderId);
      if (!incoming) {
        return Promise.reject(
          new Error(
            `Allegro test stub: no IncomingOrder registered for externalOrderId=${externalOrderId}. ` +
              `Call setNextIncomingOrder() before invoking syncOrderFromSource.`
          )
        );
      }
      return Promise.resolve(incoming);
    },
  };

  adapterRegistry.register({
    adapterKey: ALLEGRO_TEST_ADAPTER_KEY,
    platformType: ALLEGRO_TEST_PLATFORM_TYPE,
    supportedCapabilities: ['OrderSource'],
    displayName: 'Allegro (integration-test stub)',
    version: '0.0.0-test',
    // Explicit false — keeps the real `allegro.publicapi.v1` default intact
    // so production-shape connections that omit `adapterKey` still resolve
    // to the real adapter.
    isDefault: false,
  });

  factoryResolver.registerFactory(ALLEGRO_TEST_ADAPTER_KEY, {
    // The cast back to `T` lives here, once. Every other call site in the
    // stub deals with the concrete `OrderSourcePort` interface.
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(orderSourceStub as unknown as T),
  });

  return {
    adapterKey: ALLEGRO_TEST_ADAPTER_KEY,
    platformType: ALLEGRO_TEST_PLATFORM_TYPE,
    setNextIncomingOrder(incoming: IncomingOrder): void {
      orderStore.set(incoming.externalOrderId, incoming);
    },
  };
}
