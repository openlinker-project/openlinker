/**
 * Fulfillment-Relay Test Stubs Helper (#1169)
 *
 * Registers two synthetic adapters with the running Nest app's
 * `AdapterRegistryService` + `AdapterFactoryResolverService` — the same public
 * plugin seam real integrations use (#570 / #574):
 *   - a **destination** adapter: `OrderProcessorManagerPort` +
 *     `FulfillmentStatusReader`. Returns a per-test scriptable
 *     `FulfillmentStatusSnapshot` (the OMP's branch-1 view), recording each read.
 *   - a **source** adapter: `OrderSourcePort` + `OrderStatusWriteback`. Records
 *     each `write(event)` the lifecycle relay sends and returns a scriptable
 *     outcome (defaults to `applied`).
 *
 * Purpose: prove the branch-1 dispatch/cancel relay (#1160 / #1170) reaches a
 * **source** `OrderStatusWriteback` through **real identifier mappings** —
 * `FulfillmentStatusSyncService.sync(destConnId)` reads the dest snapshot, the
 * relay resolves the source target via `getExternalIds` (origin = dest,
 * excluded) and writes to it. Unit tests mock the relay; only a DB-level
 * int-spec exercises the identifier-mapping resolution end to end.
 *
 * Lifetime: suite-scoped (`AdapterRegistryService.register` throws on a second
 * call for the same adapterKey). Call once in `beforeAll`; reset the scriptable
 * snapshot / outcome and clear the recorded arrays per-test in `beforeEach`.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import type {
  FulfillmentStatusReader,
  FulfillmentStatusSnapshot,
  OrderLifecycleEvent,
  OrderProcessorManagerPort,
  OrderSourcePort,
  OrderStatusWriteback,
  OrderWritebackOutcome,
  OrderWritebackResult,
} from '@openlinker/core/orders';
import type { IntegrationTestHarness } from '../setup';

export const RELAY_SOURCE_ADAPTER_KEY = 'allegro.fulfillmentrelay.test.v1';
export const RELAY_SOURCE_PLATFORM_TYPE = 'allegro';
export const RELAY_DEST_ADAPTER_KEY = 'prestashop.fulfillmentrelay.test.v1';
export const RELAY_DEST_PLATFORM_TYPE = 'prestashop';

export interface FulfillmentRelayTestStubs {
  readonly source: {
    readonly adapterKey: string;
    readonly platformType: string;
    /** Events the relay wrote to the source via `OrderStatusWriteback.write`. */
    readonly writebackCalls: OrderLifecycleEvent[];
    /** Outcome the source stub returns from `write` (default `applied`). */
    setNextOutcome(outcome: OrderWritebackOutcome, detail?: string): void;
  };
  readonly dest: {
    readonly adapterKey: string;
    readonly platformType: string;
    /** External order ids the OMP `getFulfillmentStatus` was asked about. */
    readonly reads: string[];
    /** The OMP snapshot the dest stub returns (default: `null` status = OMP idle). */
    setNextSnapshot(snapshot: FulfillmentStatusSnapshot): void;
  };
}

export function installFulfillmentRelayTestStubs(
  harness: IntegrationTestHarness,
): FulfillmentRelayTestStubs {
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const sourceWritebackCalls: OrderLifecycleEvent[] = [];
  const destReads: string[] = [];
  let nextOutcome: OrderWritebackResult = { outcome: 'applied' };
  let nextSnapshot: FulfillmentStatusSnapshot = {
    status: null,
    trackingNumber: null,
    deliveredAt: null,
  };

  const sourceStub: OrderSourcePort & OrderStatusWriteback = {
    listOrderFeed(): Promise<never> {
      return Promise.reject(new Error('fulfillment-relay stub: listOrderFeed is not exercised'));
    },
    getOrder(): Promise<never> {
      return Promise.reject(new Error('fulfillment-relay stub: getOrder is not exercised'));
    },
    write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
      sourceWritebackCalls.push(event);
      return Promise.resolve(nextOutcome);
    },
  };

  // The dest stub declares OrderProcessorManager + the FulfillmentStatusReader
  // sub-capability the branch-1 sync resolves via `isFulfillmentStatusReader`.
  const destStub: OrderProcessorManagerPort & FulfillmentStatusReader = {
    createOrder(): Promise<never> {
      return Promise.reject(new Error('fulfillment-relay stub: createOrder is not exercised'));
    },
    getFulfillmentStatus(input: { externalOrderId: string }): Promise<FulfillmentStatusSnapshot> {
      destReads.push(input.externalOrderId);
      return Promise.resolve(nextSnapshot);
    },
  };

  adapterRegistry.register({
    adapterKey: RELAY_SOURCE_ADAPTER_KEY,
    platformType: RELAY_SOURCE_PLATFORM_TYPE,
    supportedCapabilities: ['OrderSource'],
    displayName: 'Allegro fulfillment-relay source (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });
  adapterRegistry.register({
    adapterKey: RELAY_DEST_ADAPTER_KEY,
    platformType: RELAY_DEST_PLATFORM_TYPE,
    supportedCapabilities: ['OrderProcessorManager'],
    displayName: 'PrestaShop fulfillment-relay dest (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });

  factoryResolver.registerFactory(RELAY_SOURCE_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(sourceStub as unknown as T),
  });
  factoryResolver.registerFactory(RELAY_DEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(destStub as unknown as T),
  });

  return {
    source: {
      adapterKey: RELAY_SOURCE_ADAPTER_KEY,
      platformType: RELAY_SOURCE_PLATFORM_TYPE,
      writebackCalls: sourceWritebackCalls,
      setNextOutcome(outcome: OrderWritebackOutcome, detail?: string): void {
        nextOutcome = detail ? { outcome, detail } : { outcome };
      },
    },
    dest: {
      adapterKey: RELAY_DEST_ADAPTER_KEY,
      platformType: RELAY_DEST_PLATFORM_TYPE,
      reads: destReads,
      setNextSnapshot(snapshot: FulfillmentStatusSnapshot): void {
        nextSnapshot = snapshot;
      },
    },
  };
}
