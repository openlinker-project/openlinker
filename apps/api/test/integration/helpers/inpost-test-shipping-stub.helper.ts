/**
 * InPost Test ShippingProviderManagerPort Stub Helper (#835)
 *
 * Registers a synthetic `inpost.test.v1` adapter declaring
 * `ShippingProviderManager` with the running Nest app's
 * `AdapterRegistryService` + `AdapterFactoryResolverService` — the same public
 * plugin seam real integrations use (#570 / #574). Mirrors
 * `allegro-test-source-stub.helper.ts`.
 *
 * The shipment-dispatch seam (#835) resolves the processor connection's
 * `ShippingProviderManagerPort` via `getCapabilityAdapter` and calls
 * `generateLabel`. The real InPost adapter would hit ShipX over HTTP, so the
 * int-spec routes to this in-memory stub instead — exercising the full seam
 * (real routing + compatibility + repository) against a fake provider.
 *
 * Lifetime: suite-scoped. Call once in `beforeAll`.
 *
 * @module apps/api/test/integration/helpers
 */
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import { ShippingProviderRejectionException } from '@openlinker/core/shipping';
import type {
  DispatchProtocolReader,
  GenerateLabelCommand,
  GenerateLabelResult,
  LabelDocument,
  LabelDocumentReader,
  ShipmentCanceller,
  ShippingMethod,
  ShippingProviderManagerPort,
  TrackingSnapshot,
} from '@openlinker/core/shipping';
import type { IntegrationTestHarness } from '../setup';

export const INPOST_TEST_ADAPTER_KEY = 'inpost.test.v1';
export const INPOST_TEST_PLATFORM_TYPE = 'inpost';

/** Canned label bytes the stub returns from `fetchLabel` (`%PDF` magic). */
export const STUB_LABEL_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

/** Canned handover-protocol bytes the stub returns from `generateProtocol`. */
export const STUB_PROTOCOL_BYTES = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x50]);

/**
 * Control handle returned by {@link installInpostTestShippingStub} — lets a spec
 * arrange per-order behaviour after the suite-scoped stub is installed.
 */
export interface InpostTestShippingStubHandle {
  readonly adapterKey: string;
  readonly platformType: string;
  /** Make `generateLabel` reject for this order id only (siblings still succeed). */
  failOrder(orderId: string): void;
  /** Clear all per-order failure arrangements (call between tests). */
  resetFailures(): void;
}

export function installInpostTestShippingStub(
  harness: IntegrationTestHarness,
): InpostTestShippingStubHandle {
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  let counter = 0;
  const failingOrderIds = new Set<string>();
  // Implements ShipmentCanceller + LabelDocumentReader + DispatchProtocolReader
  // too (#846 / #884 / #964): the cancel / label / bulk-protocol endpoints
  // resolve this adapter and narrow via the co-located guards. #835's dispatch
  // spec ignores the extra methods, so adding them is backward-compatible.
  const shippingStub: ShippingProviderManagerPort &
    ShipmentCanceller &
    LabelDocumentReader &
    DispatchProtocolReader = {
    getSupportedMethods(): readonly ShippingMethod[] {
      return ['paczkomat', 'kurier'];
    },
    generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult> {
      // Per-order failure hook for the #964 bulk partial-failure spec —
      // arranged via the returned handle's `failOrder(orderId)`.
      if (failingOrderIds.has(cmd.orderId)) {
        return Promise.reject(
          new ShippingProviderRejectionException(
            'inpost',
            'stub.forced-failure',
            `forced failure for ${cmd.orderId}`,
          ),
        );
      }
      counter += 1;
      return Promise.resolve({
        providerShipmentId: `stub-${counter}`,
        trackingNumber: null,
        labelPdfRef: `stub:label:${cmd.shipmentId}`,
      });
    },
    getTracking(_input: { providerShipmentId: string }): Promise<TrackingSnapshot> {
      return Promise.resolve({ status: 'generated', providerStatus: 'generated' });
    },
    cancelShipment(_input: { providerShipmentId: string }): Promise<void> {
      return Promise.resolve();
    },
    fetchLabel(_input: { providerShipmentId: string }): Promise<LabelDocument> {
      return Promise.resolve({ contentType: 'application/pdf', body: STUB_LABEL_BYTES });
    },
    generateProtocol(_input: { providerShipmentIds: string[] }): Promise<LabelDocument> {
      return Promise.resolve({ contentType: 'application/pdf', body: STUB_PROTOCOL_BYTES });
    },
  };

  adapterRegistry.register({
    adapterKey: INPOST_TEST_ADAPTER_KEY,
    platformType: INPOST_TEST_PLATFORM_TYPE,
    supportedCapabilities: ['ShippingProviderManager'],
    displayName: 'InPost (integration-test stub)',
    version: '0.0.0-test',
    isDefault: false,
  });

  factoryResolver.registerFactory(INPOST_TEST_ADAPTER_KEY, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(shippingStub as unknown as T),
  });

  return {
    adapterKey: INPOST_TEST_ADAPTER_KEY,
    platformType: INPOST_TEST_PLATFORM_TYPE,
    failOrder: (orderId: string): void => {
      failingOrderIds.add(orderId);
    },
    resetFailures: (): void => {
      failingOrderIds.clear();
    },
  };
}
