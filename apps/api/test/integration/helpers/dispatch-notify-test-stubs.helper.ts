/**
 * Dispatch-Notify Test Stubs Helper (#837)
 *
 * Registers three synthetic adapters with the running Nest app's
 * `AdapterRegistryService` + `AdapterFactoryResolverService` — the same public
 * plugin seam real integrations use (#570 / #574):
 *   - a **source** adapter: `OrderSourcePort` + `OrderDispatchNotifier` (A)
 *   - a **destination** adapter: `OrderProcessorManagerPort` +
 *     `OrderFulfillmentUpdater` (B)
 *   - a **carrier** adapter: `ShippingProviderManagerPort` whose `generateLabel`
 *     returns a synchronous tracking number (the branch-2 / InPost shape), so a
 *     shipment seeded through the real #835 dispatch seam carries a waybill.
 *
 * The dispatch-notify seam (#837) resolves the source via
 * `getCapabilityAdapter('OrderSource')` + `isOrderDispatchNotifier`, and each
 * destination via `getCapabilityAdapter('OrderProcessorManager')` +
 * `isOrderFulfillmentUpdater`. The real Allegro / PrestaShop adapters would hit
 * their APIs over HTTP, so the int-spec routes to these in-memory stubs while
 * still exercising the full resolution chain (`OrderRecord` + identifier
 * mapping + connection → adapter) against real Postgres. The source + dest
 * stubs record their calls for assertions.
 *
 * Lifetime: suite-scoped (`AdapterRegistryService.register` throws on a second
 * call for the same adapterKey). Call once in `beforeAll`; clear the `calls`
 * arrays per-test in `beforeEach` (`resetTestHarness` only clears the DB).
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
  DispatchCarrierHint,
  OrderDispatchNotifier,
  OrderFeedInput,
  OrderFeedOutput,
  OrderFulfillmentUpdater,
  OrderProcessorManagerPort,
  OrderSourcePort,
  OrderStatus,
} from '@openlinker/core/orders';
import type {
  GenerateLabelResult,
  ShippingMethod,
  ShippingProviderManagerPort,
  TrackingSnapshot,
} from '@openlinker/core/shipping';
import type { IntegrationTestHarness } from '../setup';

export const DISPATCH_SOURCE_ADAPTER_KEY = 'allegro.dispatchnotify.test.v1';
export const DISPATCH_SOURCE_PLATFORM_TYPE = 'allegro';
export const DISPATCH_DEST_ADAPTER_KEY = 'prestashop.fulfillmentupdate.test.v1';
export const DISPATCH_DEST_PLATFORM_TYPE = 'prestashop';
export const DISPATCH_CARRIER_ADAPTER_KEY = 'inpost.dispatchnotify.test.v1';
export const DISPATCH_CARRIER_PLATFORM_TYPE = 'inpost';
/** Synchronous tracking number the carrier stub stamps onto generated shipments. */
export const DISPATCH_CARRIER_TRACKING_NUMBER = 'TRACK-XYZ-1';

export interface SourceNotifyCall {
  externalOrderId: string;
  trackingNumber?: string;
  carrier?: DispatchCarrierHint;
}

export interface DestFulfillmentCall {
  externalOrderId: string;
  status: OrderStatus;
  trackingNumber?: string;
}

export interface DispatchNotifyTestStubs {
  readonly source: {
    readonly adapterKey: string;
    readonly platformType: string;
    readonly calls: SourceNotifyCall[];
  };
  readonly dest: {
    readonly adapterKey: string;
    readonly platformType: string;
    readonly calls: DestFulfillmentCall[];
  };
  readonly carrier: {
    readonly adapterKey: string;
    readonly platformType: string;
    readonly trackingNumber: string;
  };
}

export function installDispatchNotifyTestStubs(
  harness: IntegrationTestHarness,
): DispatchNotifyTestStubs {
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const sourceCalls: SourceNotifyCall[] = [];
  const destCalls: DestFulfillmentCall[] = [];

  const sourceStub: OrderSourcePort & OrderDispatchNotifier = {
    listOrderFeed(_input: OrderFeedInput): Promise<OrderFeedOutput> {
      return Promise.resolve({ items: [], nextCursor: null });
    },
    getOrder(): Promise<never> {
      return Promise.reject(new Error('dispatch-notify stub: getOrder is not exercised'));
    },
    notifyDispatched(input): Promise<void> {
      sourceCalls.push({ ...input });
      return Promise.resolve();
    },
  };

  const destStub: OrderProcessorManagerPort & OrderFulfillmentUpdater = {
    createOrder(): Promise<never> {
      return Promise.reject(new Error('dispatch-notify stub: createOrder is not exercised'));
    },
    updateFulfillment(input): Promise<void> {
      destCalls.push({ ...input });
      return Promise.resolve();
    },
  };

  let carrierCounter = 0;
  const carrierStub: ShippingProviderManagerPort = {
    getSupportedMethods(): readonly ShippingMethod[] {
      return ['paczkomat', 'kurier'];
    },
    generateLabel(): Promise<GenerateLabelResult> {
      carrierCounter += 1;
      return Promise.resolve({
        providerShipmentId: `stub-${carrierCounter}`,
        trackingNumber: DISPATCH_CARRIER_TRACKING_NUMBER,
        labelPdfRef: `stub:label:${carrierCounter}`,
      });
    },
    getTracking(): Promise<TrackingSnapshot> {
      return Promise.resolve({ status: 'generated', providerStatus: 'generated' });
    },
  };

  adapterRegistry.register({
    adapterKey: DISPATCH_SOURCE_ADAPTER_KEY,
    platformType: DISPATCH_SOURCE_PLATFORM_TYPE,
    supportedCapabilities: ['OrderSource'],
    displayName: 'Allegro dispatch-notify (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });
  adapterRegistry.register({
    adapterKey: DISPATCH_DEST_ADAPTER_KEY,
    platformType: DISPATCH_DEST_PLATFORM_TYPE,
    supportedCapabilities: ['OrderProcessorManager'],
    displayName: 'PrestaShop fulfillment-update (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });
  adapterRegistry.register({
    adapterKey: DISPATCH_CARRIER_ADAPTER_KEY,
    platformType: DISPATCH_CARRIER_PLATFORM_TYPE,
    supportedCapabilities: ['ShippingProviderManager'],
    displayName: 'InPost dispatch-notify carrier (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });

  factoryResolver.registerFactory(DISPATCH_SOURCE_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(sourceStub as unknown as T),
  });
  factoryResolver.registerFactory(DISPATCH_DEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(destStub as unknown as T),
  });
  factoryResolver.registerFactory(DISPATCH_CARRIER_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(carrierStub as unknown as T),
  });

  return {
    source: {
      adapterKey: DISPATCH_SOURCE_ADAPTER_KEY,
      platformType: DISPATCH_SOURCE_PLATFORM_TYPE,
      calls: sourceCalls,
    },
    dest: {
      adapterKey: DISPATCH_DEST_ADAPTER_KEY,
      platformType: DISPATCH_DEST_PLATFORM_TYPE,
      calls: destCalls,
    },
    carrier: {
      adapterKey: DISPATCH_CARRIER_ADAPTER_KEY,
      platformType: DISPATCH_CARRIER_PLATFORM_TYPE,
      trackingNumber: DISPATCH_CARRIER_TRACKING_NUMBER,
    },
  };
}
