/**
 * Shipment Status Sync Integration Test (#838)
 *
 * Exercises the carrier-tracking poll end-to-end against real Postgres.
 * `ShipmentStatusSyncService.sync`:
 *   - reads each non-terminal `Shipment`'s carrier state via the connection's
 *     `ShippingProviderManagerPort.getTracking` (#833 / Allegro Delivery shape:
 *     async `carrierWaybill`),
 *   - builds a desired-state patch (terminal status + `null → trackingNumber`
 *     backfill),
 *   - projects the backfilled tracking number to each destination's
 *     `OrderFulfillmentUpdater` (capability B, #858) under two v1 workarounds
 *     (push-first + `>= dispatched` push-gate; both dissolve under #861),
 *   - persists the patch via the `Shipment` repository,
 *   - returns scan stats (`scanned / updated / propagated / failed / total /
 *     nextOffset`) for the worker handler's cursor advance.
 *
 * Shipments are seeded through the real #835 dispatch seam (routed to the
 * async-waybill carrier stub returning `trackingNumber: null`), then advanced
 * to `dispatched` via #837's `notifyDispatched` so the OMP-push gate is open.
 * The carrier + destination capability adapters are in-memory stubs, so the
 * full resolution chain is real while the marketplace HTTP calls are not.
 *
 * Covers: (a) the `null → carrierWaybill` backfill with capability-B push to the
 * synced destination; (b) push-first ordering — if the OMP push throws, the
 * patch drops `trackingNumber` so the next poll retries; (c) the `>= dispatched`
 * push-gate — at `generated` the service backfills `Shipment.trackingNumber`
 * but does NOT fire the destination OMP (deferred to #837's `notifyDispatched`).
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_PROCESSOR_KIND,
  FULFILLMENT_ROUTING_SERVICE_TOKEN,
  IFulfillmentRoutingService,
} from '@openlinker/core/mappings';
import {
  IShipmentDispatchNotificationService,
  IShipmentDispatchService,
  IShipmentQueryService,
  IShipmentStatusSyncService,
  SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN,
  SHIPMENT_DISPATCH_SERVICE_TOKEN,
  SHIPMENT_QUERY_SERVICE_TOKEN,
  SHIPMENT_STATUS_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/shipping';

import { createTestOrderRecord } from './fixtures/order.fixtures';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  ShipmentStatusSyncTestStubs,
  STATUS_SYNC_CARRIER_ADAPTER_KEY,
  STATUS_SYNC_DEST_ADAPTER_KEY,
  installShipmentStatusSyncTestStubs,
} from './helpers/shipment-status-sync-test-stubs.helper';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';

const DEST_EXTERNAL_ID = 'ps-order-statussync';
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

describe('Shipment Status Sync Integration (#838)', () => {
  let harness: IntegrationTestHarness;
  let stubs: ShipmentStatusSyncTestStubs;

  beforeAll(async () => {
    harness = await getTestHarness();
    stubs = installShipmentStatusSyncTestStubs(harness);
  });

  beforeEach(() => {
    // Suite-scoped stubs — clear recorded state per test (resetTestHarness only
    // truncates the database).
    stubs.dest.calls.length = 0;
    stubs.carrier.providerShipmentIds.length = 0;
    stubs.carrier.setNextSnapshot({ status: 'generated', providerStatus: 'pending' });
    stubs.dest.setNextOutcome('ok');
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const statusSyncService = (): IShipmentStatusSyncService =>
    harness.getApp().get<IShipmentStatusSyncService>(SHIPMENT_STATUS_SYNC_SERVICE_TOKEN);
  const dispatchService = (): IShipmentDispatchService =>
    harness.getApp().get<IShipmentDispatchService>(SHIPMENT_DISPATCH_SERVICE_TOKEN);
  const notificationService = (): IShipmentDispatchNotificationService =>
    harness
      .getApp()
      .get<IShipmentDispatchNotificationService>(SHIPMENT_DISPATCH_NOTIFICATION_SERVICE_TOKEN);
  const queryService = (): IShipmentQueryService =>
    harness.getApp().get<IShipmentQueryService>(SHIPMENT_QUERY_SERVICE_TOKEN);
  const routingService = (): IFulfillmentRoutingService =>
    harness.getApp().get<IFulfillmentRoutingService>(FULFILLMENT_ROUTING_SERVICE_TOKEN);

  /**
   * Seed the resolution graph for a status-sync test: source + dest + carrier
   * connections, the `ol_managed_carrier` routing rule, the `OrderRecord` with
   * a synced destination, and (optionally) a `generated`-state shipment.
   * Returns the carrier connection id + (optional) shipment id.
   */
  async function seedShipment(
    orderId: string,
    options: { advanceToDispatched?: boolean } = {},
  ): Promise<{ carrierConnectionId: string; destConnectionId: string; shipmentId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      // The source isn't exercised by #838 — but the routing-rule keying needs
      // a source connection to scope on. Reuse the carrier stub's allegro
      // adapter-key here just to satisfy the adapter-registry lookup; this
      // record never has #837 stubs attached, so any source-side resolution
      // would surface clearly as a failure.
      adapterKey: STATUS_SYNC_CARRIER_ADAPTER_KEY,
      enabledCapabilities: ['ShippingProviderManager'],
    });
    const dest = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination',
      adapterKey: STATUS_SYNC_DEST_ADAPTER_KEY,
      enabledCapabilities: ['OrderProcessorManager'],
    });
    const carrier = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro Delivery carrier',
      adapterKey: STATUS_SYNC_CARRIER_ADAPTER_KEY,
      enabledCapabilities: ['ShippingProviderManager'],
    });

    await routingService().replaceRules(source.id, [
      {
        sourceDeliveryMethodId: SOURCE_DELIVERY_METHOD_ID,
        processorKind: FULFILLMENT_PROCESSOR_KIND.OlManagedCarrier,
        processorConnectionId: carrier.id,
      },
    ]);

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
    const shipmentId = dispatched.shipment.id;

    if (options.advanceToDispatched) {
      // Drive the real #837 transition so the push-gate is open. The source
      // OrderDispatchNotifier isn't registered for this connection — the
      // dest is — so the source half degrades to 'absent' / 'unsupported',
      // which doesn't block the `generated → dispatched` Shipment transition.
      // Hop SOURCE → DEST mapping out of #837's view: we just need the
      // Shipment row in `dispatched` so #838 fires capability B.
      await notificationService().notifyDispatched({ shipmentId });
      // Reset the dest stub's recorded calls — the dispatch-notify wave that
      // just ran would otherwise count toward our #838 assertions. (The
      // notifyDispatched call will have invoked dest.updateFulfillment once
      // because the destination implements capability B.)
      stubs.dest.calls.length = 0;
    }

    return { carrierConnectionId: carrier.id, destConnectionId: dest.id, shipmentId };
  }

  it('backfills a freshly-arrived carrierWaybill on a dispatched shipment and pushes shipped+tracking to the destination', async () => {
    const { carrierConnectionId, shipmentId } = await seedShipment('ol_order_statussync_1', {
      advanceToDispatched: true,
    });

    // Carrier reports the waybill on the next poll.
    stubs.carrier.setNextSnapshot({
      status: 'dispatched',
      providerStatus: 'waybill-assigned',
      trackingNumber: 'NEW-WAYBILL',
    });

    const result = await statusSyncService().sync(carrierConnectionId, { limit: 10 });

    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.propagated).toBe(1);
    expect(result.failed).toBe(0);

    // Capability B was invoked with the backfilled tracking number.
    expect(stubs.dest.calls).toEqual([
      {
        externalOrderId: DEST_EXTERNAL_ID,
        status: 'shipped',
        trackingNumber: 'NEW-WAYBILL',
      },
    ]);

    // Patch landed on the Shipment row.
    const persisted = await queryService().getById(shipmentId);
    expect(persisted?.trackingNumber).toBe('NEW-WAYBILL');
    // Status doesn't regress; `dispatched` carrier state ≠ terminal so the
    // service leaves the existing `dispatched` row alone.
    expect(persisted?.status).toBe('dispatched');
  });

  it('PUSH-FIRST: drops trackingNumber from the Shipment patch when the destination OMP push throws (v1 workaround #1, #861-dissolves)', async () => {
    const { carrierConnectionId, shipmentId } = await seedShipment('ol_order_statussync_2', {
      advanceToDispatched: true,
    });

    stubs.carrier.setNextSnapshot({
      status: 'dispatched',
      providerStatus: 'waybill-assigned',
      trackingNumber: 'WOULD-LOSE-1',
    });
    stubs.dest.setNextOutcome({ throw: new Error('PS unreachable') });

    const result = await statusSyncService().sync(carrierConnectionId, { limit: 10 });

    // The push was attempted (call recorded) but no patch persisted — `updated`
    // and `propagated` both 0 because the single patch-field (tracking) was
    // dropped when the push failed.
    expect(stubs.dest.calls).toHaveLength(1);
    expect(stubs.dest.calls[0]?.trackingNumber).toBe('WOULD-LOSE-1');
    expect(result.updated).toBe(0);
    expect(result.propagated).toBe(0);
    // Per-destination push failure is logged + masked at the push layer; it
    // doesn't count as a top-level shipment failure (see service jsdoc).
    expect(result.failed).toBe(0);

    const persisted = await queryService().getById(shipmentId);
    expect(persisted?.trackingNumber).toBeNull();
  });

  it('PUSH-GATE: at `generated` backfills Shipment.trackingNumber but does NOT fire capability B (deferred to #837, v1 workaround #2)', async () => {
    const { carrierConnectionId, shipmentId } = await seedShipment('ol_order_statussync_3', {
      advanceToDispatched: false,
    });

    stubs.carrier.setNextSnapshot({
      status: 'generated',
      providerStatus: 'waybill-assigned',
      trackingNumber: 'BACKFILL-ONLY',
    });

    const result = await statusSyncService().sync(carrierConnectionId, { limit: 10 });

    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.propagated).toBe(0);
    expect(stubs.dest.calls).toHaveLength(0);

    const persisted = await queryService().getById(shipmentId);
    expect(persisted?.trackingNumber).toBe('BACKFILL-ONLY');
    expect(persisted?.status).toBe('generated');
  });
});
