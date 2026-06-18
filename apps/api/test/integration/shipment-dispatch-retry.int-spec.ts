/**
 * Shipment Dispatch Retry Integration Test (#1101)
 *
 * Regression guard for the failed-pre-waybill retry wedge: a dispatch that
 * fails before a waybill is minted leaves a terminal `(orderId, connectionId)`
 * row with `providerShipmentId = NULL`. The partial-unique
 * `UQ_shipments_branch_one_per_order_conn` index forbids a second waybill-less
 * row, so a naive retry `create()` would raise a duplicate-key error and wedge
 * every retry. `ShipmentDispatchService` reuses + resets that branch-one row
 * instead — this spec exercises that against the REAL Postgres constraint
 * (a mocked repository can't reproduce the index violation).
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
  ShippingProviderRejectionException,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  INPOST_TEST_ADAPTER_KEY,
  InpostTestShippingStubHandle,
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

interface ShipmentRow {
  id: string;
  status: string;
  providerShipmentId: string | null;
}

describe('Shipment Dispatch Retry Integration (#1101)', () => {
  let harness: IntegrationTestHarness;
  let stub: InpostTestShippingStubHandle;

  beforeAll(async () => {
    harness = await getTestHarness();
    stub = installInpostTestShippingStub(harness);
  });

  afterEach(async () => {
    stub.resetFailures();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const dispatchService = (): IShipmentDispatchService =>
    harness.getApp().get<IShipmentDispatchService>(SHIPMENT_DISPATCH_SERVICE_TOKEN);
  const routingService = (): IFulfillmentRoutingService =>
    harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);

  async function shipmentRows(orderId: string): Promise<ShipmentRow[]> {
    return harness
      .getDataSource()
      .query(
        'SELECT "id", "status", "providerShipmentId" FROM "shipments" WHERE "orderId" = $1 ORDER BY "createdAt"',
        [orderId],
      ) as Promise<ShipmentRow[]>;
  }

  async function seedManagedCarrier(): Promise<{ sourceId: string; carrierId: string }> {
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
        sourceDeliveryMethodId: 'allegro-courier',
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: carrier.id,
      },
    ]);
    return { sourceId: source.id, carrierId: carrier.id };
  }

  it('should reuse the failed branch-one row on retry — no UQ_shipments_branch_one_per_order_conn violation', async () => {
    const { sourceId } = await seedManagedCarrier();
    const input: ShipmentDispatchInput = {
      sourceConnectionId: sourceId,
      sourceDeliveryMethodId: 'allegro-courier',
      orderId: 'ol_order_retry_1',
      shippingMethod: 'kurier',
      recipient: RECIPIENT,
      parcel: PARCEL,
    };

    // Dispatch 1: the provider rejects before a waybill is minted → the service
    // persists a `failed`, null-waybill row and rethrows.
    stub.failOrder(input.orderId);
    await expect(dispatchService().dispatch(input)).rejects.toBeInstanceOf(
      ShippingProviderRejectionException,
    );
    const afterFail = await shipmentRows(input.orderId);
    expect(afterFail).toHaveLength(1);
    expect(afterFail[0]).toMatchObject({ status: 'failed', providerShipmentId: null });
    const failedRowId = afterFail[0].id;

    // Dispatch 2 (credentials "fixed"): must reuse + reset the existing
    // branch-one row, NOT insert a duplicate (which the partial-unique index
    // would reject with a QueryFailedError).
    stub.resetFailures();
    const retry = await dispatchService().dispatch(input);
    expect(retry.kind).toBe('dispatched');

    const afterRetry = await shipmentRows(input.orderId);
    expect(afterRetry).toHaveLength(1); // reused, not duplicated
    // Same row id proves REUSE (reset in place), not delete-and-recreate.
    expect(afterRetry[0].id).toBe(failedRowId);
    expect(afterRetry[0].status).toBe('generated');
    expect(afterRetry[0].providerShipmentId).toMatch(/^stub-/);
  });
});
