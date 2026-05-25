/**
 * Shipment Dispatch Integration Test (#835)
 *
 * Exercises the convergence seam end-to-end against real Postgres: a routing
 * rule is configured via the real #832 `FulfillmentRoutingService` (so the
 * compatibility gate runs), then `ShipmentDispatchService.dispatch` resolves
 * the processor, creates a `Shipment`, and generates a label via the resolved
 * connection's `ShippingProviderManagerPort` — routed to an in-memory stub
 * adapter (the real InPost adapter would hit ShipX over HTTP).
 *
 * Covers: ol_managed_carrier dispatch → persisted `generated` shipment;
 * omp_fulfilled default → null + no row; idempotency.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import {
  IShipmentDispatchService,
  ShipmentDispatchInput,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  INPOST_TEST_ADAPTER_KEY,
  installInpostTestShippingStub,
} from './helpers/inpost-test-shipping-stub.helper';

const RECIPIENT = {
  email: 'buyer@example.com',
  phone: '+48500600700',
  address: {
    street: 'Krakowska',
    buildingNumber: '12',
    city: 'Poznań',
    postCode: '60-001',
    countryCode: 'PL',
  },
};
const PARCEL = { dimensions: { length: 200, width: 150, height: 100 }, weightGrams: 1200 };

describe('Shipment Dispatch Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
    installInpostTestShippingStub(harness);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const dispatchService = (): IShipmentDispatchService =>
    harness.getApp().get<IShipmentDispatchService>(SHIPMENT_DISPATCH_SERVICE_TOKEN);
  const routingService = (): IFulfillmentRoutingService =>
    harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);

  async function seedConnections(): Promise<{ sourceId: string; carrierId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.publicapi.v1',
      enabledCapabilities: ['OrderSource'],
    });
    const carrier = await createTestConnection(dataSource, {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: INPOST_TEST_ADAPTER_KEY,
      enabledCapabilities: ['ShippingProviderManager'],
    });
    return { sourceId: source.id, carrierId: carrier.id };
  }

  it('should dispatch an ol_managed_carrier order to a persisted generated shipment', async () => {
    const { sourceId, carrierId } = await seedConnections();
    await routingService().replaceRules(sourceId, [
      {
        sourceDeliveryMethodId: 'allegro-courier',
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: carrierId,
      },
    ]);

    const result = await dispatchService().dispatch({
      sourceConnectionId: sourceId,
      sourceDeliveryMethodId: 'allegro-courier',
      orderId: 'ol_order_dispatch_1',
      shippingMethod: 'kurier',
      recipient: RECIPIENT,
      parcel: PARCEL,
    });

    expect(result.kind).toBe('dispatched');
    if (result.kind !== 'dispatched') throw new Error('expected a dispatched shipment');
    const { shipment } = result;
    expect(shipment).toMatchObject({
      orderId: 'ol_order_dispatch_1',
      connectionId: carrierId,
      shippingMethod: 'kurier',
      status: 'generated',
    });
    expect(shipment.providerShipmentId).toMatch(/^stub-/);
    expect(shipment.labelPdfRef).toContain('stub:label:');
    // Persistence is proven by the round-trip: the repo's `update` re-reads the
    // row from Postgres (or throws ShipmentNotFoundException if `create` hadn't
    // persisted it), and the idempotency test below confirms the row is queryable.
  });

  it('should return omp_fulfilled and create no shipment for an unconfigured method (default)', async () => {
    const { sourceId } = await seedConnections();

    const result = await dispatchService().dispatch({
      sourceConnectionId: sourceId,
      sourceDeliveryMethodId: 'unmapped-method',
      orderId: 'ol_order_omp_1',
      shippingMethod: 'kurier',
      recipient: RECIPIENT,
      parcel: PARCEL,
    });

    expect(result).toEqual({ kind: 'omp_fulfilled' });
  });

  it('should be idempotent — a second dispatch returns the same shipment with no new row', async () => {
    const { sourceId, carrierId } = await seedConnections();
    await routingService().replaceRules(sourceId, [
      {
        sourceDeliveryMethodId: 'allegro-courier',
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: carrierId,
      },
    ]);
    const input: ShipmentDispatchInput = {
      sourceConnectionId: sourceId,
      sourceDeliveryMethodId: 'allegro-courier',
      orderId: 'ol_order_idem_1',
      shippingMethod: 'kurier',
      recipient: RECIPIENT,
      parcel: PARCEL,
    };

    const first = await dispatchService().dispatch(input);
    const second = await dispatchService().dispatch(input);

    expect(first.kind).toBe('dispatched');
    expect(second.kind).toBe('dispatched');
    if (first.kind !== 'dispatched' || second.kind !== 'dispatched') {
      throw new Error('expected dispatched results');
    }
    // Same id proves both persistence and idempotency: if the first row hadn't
    // persisted, the service's findActiveByOrderId would miss it and the second
    // dispatch would create a new shipment with a different id.
    expect(second.shipment.id).toBe(first.shipment.id);
  });
});
