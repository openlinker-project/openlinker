/**
 * Shipment Dispatch Notification Integration Test (#837)
 *
 * Exercises the "mark sent on source + OMP" orchestration end-to-end against
 * real Postgres. `ShipmentDispatchNotificationService.notifyDispatched`:
 *   - resolves the order's source + destination(s) from its `OrderRecord`,
 *   - resolves the source external id from the identifier-mapping table,
 *   - resolves the carrier hint from the shipment's processor connection,
 *   - drives `OrderDispatchNotifier` on the source (A) and
 *     `OrderFulfillmentUpdater` on each destination (B), then
 *   - transitions the `Shipment` to `dispatched`.
 *
 * The shipment is seeded through the real #835 dispatch seam (routed to an
 * in-memory carrier stub that returns a synchronous tracking number), never
 * the repository — mirroring `shipments-read.int-spec.ts` and keeping the test
 * off the cross-context-banned `ShipmentRepositoryPort`. The source + dest
 * capability adapters are likewise in-memory stubs, so the full resolution
 * chain is real while the marketplace HTTP calls are not. This verifies the
 * orchestration wiring, NOT the PrestaShop write (capability B's PrestaShop
 * implementation is a focused follow-up; until it lands the destination half
 * degrades to `unsupported`).
 *
 * Covers: happy path (A + B invoked with resolved external ids + carrier hint →
 * `dispatched`); status-gate at-most-once (a second notify after `dispatched`
 * is skipped and re-invokes neither A nor B).
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  IShipmentDispatchNotificationService,
  IShipmentDispatchService,
  IShipmentQueryService,
  SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  DISPATCH_CARRIER_ADAPTER_KEY,
  DISPATCH_CARRIER_TRACKING_NUMBER,
  DISPATCH_DEST_ADAPTER_KEY,
  DISPATCH_SOURCE_ADAPTER_KEY,
  DispatchNotifyTestStubs,
  installDispatchNotifyTestStubs,
} from './helpers/dispatch-notify-test-stubs.helper';
import { createTestOrderRecord } from './fixtures/order.fixtures';
import { loginAsAdmin } from './helpers/test-auth.helper';

const SOURCE_EXTERNAL_ID = 'allegro-checkout-AAA';
const DEST_EXTERNAL_ID = 'ps-order-77';
const SOURCE_DELIVERY_METHOD_ID = 'allegro-courier';
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

describe('Shipment Dispatch Notification Integration', () => {
  let harness: IntegrationTestHarness;
  let stubs: DispatchNotifyTestStubs;

  beforeAll(async () => {
    harness = await getTestHarness();
    stubs = installDispatchNotifyTestStubs(harness);
  });

  beforeEach(() => {
    // Stubs are suite-scoped; the recorded calls must be cleared per-test
    // (resetTestHarness only truncates the database).
    stubs.source.calls.length = 0;
    stubs.dest.calls.length = 0;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const notificationService = (): IShipmentDispatchNotificationService =>
    harness
      .getApp()
      .get<IShipmentDispatchNotificationService>(SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN);
  const dispatchService = (): IShipmentDispatchService =>
    harness.getApp().get<IShipmentDispatchService>(SHIPMENT_DISPATCH_SERVICE_TOKEN);
  const queryService = (): IShipmentQueryService =>
    harness.getApp().get<IShipmentQueryService>(SHIPMENT_QUERY_SERVICE_TOKEN);
  const routingService = (): IFulfillmentRoutingService =>
    harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);
  const identifierMapping = (): IIdentifierMappingService =>
    harness.getApp().get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);

  /**
   * Seed the full resolution graph for one dispatched shipment:
   * source + dest + carrier connections, an `ol_managed_carrier` routing rule,
   * the Order→source identifier mapping, an OrderRecord (source + a synced
   * destination), and a `generated` shipment (with tracking) produced by the
   * real dispatch seam. Returns the shipment id + destination connection id.
   */
  async function seedDispatchableShipment(orderId: string): Promise<{
    shipmentId: string;
    destId: string;
  }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: DISPATCH_SOURCE_ADAPTER_KEY,
      enabledCapabilities: ['OrderSource'],
    });
    const dest = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination',
      adapterKey: DISPATCH_DEST_ADAPTER_KEY,
      enabledCapabilities: ['OrderProcessorManager'],
    });
    const carrier = await createTestConnection(dataSource, {
      platformType: 'inpost',
      name: 'InPost carrier',
      adapterKey: DISPATCH_CARRIER_ADAPTER_KEY,
      enabledCapabilities: ['ShippingProviderManager'],
    });

    await routingService().replaceRules(source.id, [
      {
        sourceDeliveryMethodId: SOURCE_DELIVERY_METHOD_ID,
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: carrier.id,
      },
    ]);

    await identifierMapping().createMapping(
      CORE_ENTITY_TYPE.Order,
      SOURCE_EXTERNAL_ID,
      source.id,
      orderId,
    );

    await createTestOrderRecord(dataSource, {
      internalOrderId: orderId,
      sourceConnectionId: source.id,
      syncStatus: [
        {
          destinationConnectionId: dest.id,
          status: 'synced',
          externalOrderId: DEST_EXTERNAL_ID,
        },
      ],
    });

    const dispatched = await dispatchService().dispatch({
      sourceConnectionId: source.id,
      sourceDeliveryMethodId: SOURCE_DELIVERY_METHOD_ID,
      orderId,
      shippingMethod: 'kurier',
      recipient: RECIPIENT,
      parcel: PARCEL,
    });
    if (dispatched.kind !== 'dispatched') {
      throw new Error(`expected a dispatched shipment, got ${dispatched.kind}`);
    }

    return { shipmentId: dispatched.shipment.id, destId: dest.id };
  }

  it('should notify source + destination with resolved ids and transition the shipment to dispatched', async () => {
    const { shipmentId, destId } = await seedDispatchableShipment('ol_order_notify_1');

    const result = await notificationService().notifyDispatched({ shipmentId });

    expect(result).toEqual({
      shipmentId,
      outcome: 'notified',
      source: 'ok',
      destinations: [{ connectionId: destId, status: 'ok' }],
    });

    // A — source mark-sent received the resolved external id, the synchronous
    // tracking number, and the carrier hint resolved from the shipment's
    // (InPost) processor connection.
    expect(stubs.source.calls).toEqual([
      {
        externalOrderId: SOURCE_EXTERNAL_ID,
        trackingNumber: DISPATCH_CARRIER_TRACKING_NUMBER,
        carrier: { platformType: 'inpost' },
      },
    ]);

    // B — destination fulfillment-update received the dest external id resolved
    // from OrderRecord.syncStatus, OL status 'shipped', and the tracking number.
    expect(stubs.dest.calls).toEqual([
      {
        externalOrderId: DEST_EXTERNAL_ID,
        status: 'shipped',
        trackingNumber: DISPATCH_CARRIER_TRACKING_NUMBER,
      },
    ]);

    // Transition is persisted (re-read from Postgres through the read seam).
    const persisted = await queryService().getById(shipmentId);
    expect(persisted?.status).toBe('dispatched');
    expect(persisted?.dispatchedAt).not.toBeNull();
  });

  it('should skip a second notify after dispatch and re-invoke neither source nor destination', async () => {
    const { shipmentId } = await seedDispatchableShipment('ol_order_notify_2');

    const first = await notificationService().notifyDispatched({ shipmentId });
    expect(first.outcome).toBe('notified');
    expect(stubs.source.calls).toHaveLength(1);
    expect(stubs.dest.calls).toHaveLength(1);

    const second = await notificationService().notifyDispatched({ shipmentId });

    // Status-gate: the persisted `dispatched` transition makes the second call a
    // no-op — the at-most-once guarantee for the source waybill-attach.
    expect(second).toEqual({
      shipmentId,
      outcome: 'skipped-not-generated',
      source: 'absent',
      destinations: [],
    });
    expect(stubs.source.calls).toHaveLength(1);
    expect(stubs.dest.calls).toHaveLength(1);
  });

  describe('POST /shipments/:id/notify-dispatched (#769 HTTP endpoint)', () => {
    it('should run the orchestration end-to-end and return 200 with the result shape', async () => {
      const { shipmentId, destId } = await seedDispatchableShipment('ol_order_notify_http_1');

      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const response = await http
        .post(`/shipments/${shipmentId}/notify-dispatched`)
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        shipmentId,
        outcome: 'notified',
        source: 'ok',
        destinations: [{ connectionId: destId, status: 'ok' }],
      });

      // Same shipped-stubs verification as the service-call test above:
      expect(stubs.source.calls).toHaveLength(1);
      expect(stubs.dest.calls).toHaveLength(1);

      const persisted = await queryService().getById(shipmentId);
      expect(persisted?.status).toBe('dispatched');
    });

    it('should idempotent-no-op on second HTTP call (200 + outcome=skipped-not-generated)', async () => {
      const { shipmentId } = await seedDispatchableShipment('ol_order_notify_http_2');

      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const first = await http
        .post(`/shipments/${shipmentId}/notify-dispatched`)
        .set('Authorization', `Bearer ${token}`);
      expect(first.status).toBe(200);
      expect(first.body.outcome).toBe('notified');

      const second = await http
        .post(`/shipments/${shipmentId}/notify-dispatched`)
        .set('Authorization', `Bearer ${token}`);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({
        shipmentId,
        outcome: 'skipped-not-generated',
        source: 'absent',
        destinations: [],
      });

      // No additional source/dest invocations from the second call.
      expect(stubs.source.calls).toHaveLength(1);
      expect(stubs.dest.calls).toHaveLength(1);
    });

    it('should return 404 when the shipment id does not exist', async () => {
      const http = harness.getHttp();
      const token = await loginAsAdmin(http, harness.getDataSource());

      const response = await http
        .post('/shipments/ol_shipment_nonexistent/notify-dispatched')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(404);
      expect(response.body.message).toMatch(/shipment not found/i);
    });
  });
});
