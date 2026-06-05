/**
 * Bulk Shipment Dispatch Integration Test (#964)
 *
 * Exercises the synchronous bulk surface (ADR-019) end-to-end against real
 * Postgres: a routing rule is configured via the real #832
 * `FulfillmentRoutingService`, then `BulkShipmentDispatchService.dispatchBulk`
 * loops the per-order dispatch seam (creating one `Shipment` row per order via
 * the in-memory InPost stub), and `generateProtocol` resolves the dispatched
 * shipments' single carrier connection and narrows `DispatchProtocolReader`.
 *
 * Covers: all-success bulk → N persisted `generated` shipments + a protocol;
 * partial-failure survival (one order forced to fail, siblings still dispatch);
 * protocol over the succeeded shipments only.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import {
  IBulkShipmentDispatchService,
  IShipmentQueryService,
  BULK_SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  INPOST_TEST_ADAPTER_KEY,
  STUB_PROTOCOL_BYTES,
  installInpostTestShippingStub,
  type InpostTestShippingStubHandle,
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
const METHOD = 'allegro-courier';

describe('Bulk Shipment Dispatch Integration (#964)', () => {
  let harness: IntegrationTestHarness;
  let shippingStub: InpostTestShippingStubHandle;

  beforeAll(async () => {
    harness = await getTestHarness();
    shippingStub = installInpostTestShippingStub(harness);
  });

  afterEach(async () => {
    shippingStub.resetFailures();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const bulkService = (): IBulkShipmentDispatchService =>
    harness.getApp().get<IBulkShipmentDispatchService>(BULK_SHIPMENT_DISPATCH_SERVICE_TOKEN);
  const queryService = (): IShipmentQueryService =>
    harness.getApp().get<IShipmentQueryService>(SHIPMENT_QUERY_SERVICE_TOKEN);
  const routingService = (): IFulfillmentRoutingService =>
    harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);

  async function seedRoutedConnections(): Promise<{ sourceId: string; carrierId: string }> {
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
    await routingService().replaceRules(source.id, [
      {
        sourceDeliveryMethodId: METHOD,
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: carrier.id,
      },
    ]);
    return { sourceId: source.id, carrierId: carrier.id };
  }

  function item(orderId: string) {
    return {
      sourceDeliveryMethodId: METHOD,
      orderId,
      shippingMethod: 'kurier' as const,
      recipient: RECIPIENT,
      parcel: PARCEL,
    };
  }

  it('should dispatch every order to a persisted shipment and produce one handover protocol', async () => {
    const { sourceId, carrierId } = await seedRoutedConnections();

    const result = await bulkService().dispatchBulk({
      sourceConnectionId: sourceId,
      items: [item('ol_order_bulk_1'), item('ol_order_bulk_2')],
    });

    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.kind === 'dispatched')).toBe(true);

    const shipmentIds = result.results.flatMap((r) => (r.kind === 'dispatched' ? [r.shipment.id] : []));
    expect(shipmentIds).toHaveLength(2);

    // Each shipment really persisted on the carrier connection.
    for (const id of shipmentIds) {
      const persisted = await queryService().getById(id);
      expect(persisted).toMatchObject({ connectionId: carrierId, status: 'generated' });
    }

    // The protocol resolves the single carrier connection + DispatchProtocolReader.
    const protocol = await bulkService().generateProtocol({ shipmentIds });
    expect(protocol.contentType).toBe('application/pdf');
    expect(Buffer.from(protocol.body)).toEqual(Buffer.from(STUB_PROTOCOL_BYTES));
  });

  it('should isolate a per-order failure and still protocol the succeeded shipments (AC-6)', async () => {
    const { sourceId } = await seedRoutedConnections();
    // Arrange the middle order to fail at the carrier; siblings should survive.
    shippingStub.failOrder('ol_order_boom');

    const result = await bulkService().dispatchBulk({
      sourceConnectionId: sourceId,
      items: [item('ol_order_ok_1'), item('ol_order_boom'), item('ol_order_ok_2')],
    });

    expect(result.results).toHaveLength(3);
    expect(result.results[0].kind).toBe('dispatched');
    expect(result.results[1]).toMatchObject({ kind: 'failed', orderId: 'ol_order_boom' });
    expect(result.results[2].kind).toBe('dispatched');

    // A protocol over the two successes still works (the failure didn't sink them).
    const shipmentIds = result.results.flatMap((r) => (r.kind === 'dispatched' ? [r.shipment.id] : []));
    expect(shipmentIds).toHaveLength(2);
    const protocol = await bulkService().generateProtocol({ shipmentIds });
    expect(protocol.contentType).toBe('application/pdf');
  });
});
