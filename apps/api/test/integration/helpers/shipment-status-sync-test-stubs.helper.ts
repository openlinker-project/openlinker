/**
 * Shipment Status Sync Test Stubs Helper (#838)
 *
 * Registers two synthetic adapters with the running Nest app's
 * `AdapterRegistryService` + `AdapterFactoryResolverService` (the same public
 * plugin seam real integrations use, #570 / #574):
 *
 *   - a **carrier** adapter implementing `ShippingProviderManagerPort` with a
 *     `generateLabel` that returns *no* synchronous tracking number — mirroring
 *     Allegro Delivery, where the carrier waybill arrives asynchronously after
 *     create — and a `getTracking` whose response is **configurable per test**
 *     (`carrier.setNextSnapshot(snap)`), so the int-spec can drive the
 *     `null → carrierWaybill` backfill transition the service projects.
 *   - a **destination** adapter implementing `OrderProcessorManagerPort` +
 *     `OrderFulfillmentUpdater`, recording its `updateFulfillment` calls so the
 *     int-spec can assert that capability B's projection fires (push-first
 *     ordering + `>= dispatched` push-gate).
 *
 * Mirrors `dispatch-notify-test-stubs.helper.ts` (#837) — same registration
 * shape, same Symbol-token resolution, distinct adapter keys so both helpers
 * can coexist in the same suite. Lifetime: suite-scoped (`AdapterRegistryService
 * .register` throws on a second call for the same adapterKey).
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
  OrderFulfillmentUpdater,
  OrderProcessorManagerPort,
  OrderStatus,
} from '@openlinker/core/orders';
import type {
  GenerateLabelCommand,
  GenerateLabelResult,
  ShippingMethod,
  ShippingProviderManagerPort,
  TrackingSnapshot,
} from '@openlinker/core/shipping';
import type { IntegrationTestHarness } from '../setup';

export const STATUS_SYNC_CARRIER_ADAPTER_KEY = 'allegro.delivery.statussync.test.v1';
export const STATUS_SYNC_CARRIER_PLATFORM_TYPE = 'allegro';
export const STATUS_SYNC_DEST_ADAPTER_KEY = 'prestashop.fulfillmentupdate.statussync.test.v1';
export const STATUS_SYNC_DEST_PLATFORM_TYPE = 'prestashop';

export interface DestFulfillmentCall {
  externalOrderId: string;
  status: OrderStatus;
  trackingNumber?: string;
}

export interface ShipmentStatusSyncTestStubs {
  readonly carrier: {
    readonly adapterKey: string;
    readonly platformType: string;
    /** Set the snapshot the next `getTracking` call will resolve with. */
    setNextSnapshot(snapshot: TrackingSnapshot): void;
    /** Provider shipment ids handed out by `generateLabel`, in call order. */
    readonly providerShipmentIds: string[];
  };
  readonly dest: {
    readonly adapterKey: string;
    readonly platformType: string;
    /** Override the next `updateFulfillment` call's behaviour (resolve / reject). */
    setNextOutcome(outcome: 'ok' | { throw: Error }): void;
    readonly calls: DestFulfillmentCall[];
  };
}

export function installShipmentStatusSyncTestStubs(
  harness: IntegrationTestHarness,
): ShipmentStatusSyncTestStubs {
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  // Carrier — async waybill shape (Allegro Delivery).
  let carrierCounter = 0;
  const providerShipmentIds: string[] = [];
  let nextSnapshot: TrackingSnapshot = { status: 'generated', providerStatus: 'pending' };

  const carrierStub: ShippingProviderManagerPort = {
    getSupportedMethods(): readonly ShippingMethod[] {
      return ['paczkomat', 'kurier'];
    },
    generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
      carrierCounter += 1;
      const providerShipmentId = `delivery-stub-${carrierCounter}`;
      providerShipmentIds.push(providerShipmentId);
      return Promise.resolve({
        providerShipmentId,
        // Async-waybill shape: tracking comes on a later poll.
        trackingNumber: null,
        labelPdfRef: `delivery-stub:label:${cmd.shipmentId}`,
      });
    },
    getTracking(): Promise<TrackingSnapshot> {
      return Promise.resolve(nextSnapshot);
    },
  };

  // Destination — capability B (records calls + supports a one-shot throw).
  const destCalls: DestFulfillmentCall[] = [];
  let nextDestOutcome: 'ok' | { throw: Error } = 'ok';

  const destStub: OrderProcessorManagerPort & OrderFulfillmentUpdater = {
    createOrder(): Promise<never> {
      return Promise.reject(new Error('status-sync stub: createOrder is not exercised'));
    },
    updateFulfillment(input): Promise<void> {
      destCalls.push({ ...input });
      const outcome = nextDestOutcome;
      nextDestOutcome = 'ok';
      if (typeof outcome === 'object' && outcome !== null && 'throw' in outcome) {
        return Promise.reject(outcome.throw);
      }
      return Promise.resolve();
    },
  };

  adapterRegistry.register({
    adapterKey: STATUS_SYNC_CARRIER_ADAPTER_KEY,
    platformType: STATUS_SYNC_CARRIER_PLATFORM_TYPE,
    supportedCapabilities: ['ShippingProviderManager'],
    displayName: 'Allegro Delivery status-sync carrier (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });
  adapterRegistry.register({
    adapterKey: STATUS_SYNC_DEST_ADAPTER_KEY,
    platformType: STATUS_SYNC_DEST_PLATFORM_TYPE,
    supportedCapabilities: ['OrderProcessorManager'],
    displayName: 'PrestaShop status-sync destination (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });

  factoryResolver.registerFactory(STATUS_SYNC_CARRIER_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(carrierStub as unknown as T),
  });
  factoryResolver.registerFactory(STATUS_SYNC_DEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(destStub as unknown as T),
  });

  return {
    carrier: {
      adapterKey: STATUS_SYNC_CARRIER_ADAPTER_KEY,
      platformType: STATUS_SYNC_CARRIER_PLATFORM_TYPE,
      setNextSnapshot(snapshot: TrackingSnapshot): void {
        nextSnapshot = snapshot;
      },
      providerShipmentIds,
    },
    dest: {
      adapterKey: STATUS_SYNC_DEST_ADAPTER_KEY,
      platformType: STATUS_SYNC_DEST_PLATFORM_TYPE,
      setNextOutcome(outcome: 'ok' | { throw: Error }): void {
        nextDestOutcome = outcome;
      },
      calls: destCalls,
    },
  };
}
