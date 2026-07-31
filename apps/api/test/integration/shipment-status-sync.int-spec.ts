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
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
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
  STATUS_SYNC_CARRIER_PLATFORM_TYPE,
  STATUS_SYNC_DEST_ADAPTER_KEY,
  STATUS_SYNC_SOURCE_ADAPTER_KEY,
  installShipmentStatusSyncTestStubs,
} from './helpers/shipment-status-sync-test-stubs.helper';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';

const DEST_EXTERNAL_ID = 'ps-order-statussync';
const SOURCE_EXTERNAL_ID = 'allegro-order-statussync';
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
    stubs.source.writebackCalls.length = 0;
    stubs.carrier.providerShipmentIds.length = 0;
    stubs.carrier.setNextSnapshot({ status: 'generated', providerStatus: 'pending' });
    // Outcome queue drains naturally; left empty here so each test stages what it needs.
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
  const identifierMapping = (): IIdentifierMappingService =>
    harness.getApp().get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
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
    // Source connection — distinct adapter declaring `OrderSource` only.
    // #838 never touches it, but the routing-rule + OrderRecord seam needs a
    // source connection on the same platformType as the upstream marketplace.
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: STATUS_SYNC_SOURCE_ADAPTER_KEY,
      enabledCapabilities: ['OrderSource'],
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

    // #1947: the waybill relay resolves participants from the Order's identifier
    // mappings, so BOTH the source and the destination need one. Pre-#1947 the
    // destination-only push read `record.syncStatus` instead, which is exactly
    // why the source could never be reached.
    await identifierMapping().createMapping(
      CORE_ENTITY_TYPE.Order,
      SOURCE_EXTERNAL_ID,
      source.id,
      orderId,
    );
    await identifierMapping().createMapping(
      CORE_ENTITY_TYPE.Order,
      DEST_EXTERNAL_ID,
      dest.id,
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
    const shipmentId = dispatched.shipment.id;

    if (options.advanceToDispatched) {
      // Drive the real #837 transition so the relay gate is open. This wave
      // reaches BOTH participants through the lifecycle relay (#1168) now that
      // #1947 seeds Order identifier mappings for the source as well as the
      // destination — and it carries NO waybill, because ShipX mints one only at
      // confirmation. That absence is exactly the #1947 condition, reproduced
      // here for real rather than simulated.
      await notificationService().notifyDispatched({ shipmentId });
      // Drop the dispatch wave so each test asserts only about the BACKFILL wave
      // it stages. Not belt-and-suspenders any more: with the source mapping
      // seeded, both arrays genuinely receive an entry above.
      stubs.dest.calls.length = 0;
      stubs.source.writebackCalls.length = 0;
    }

    return { carrierConnectionId: carrier.id, destConnectionId: dest.id, shipmentId };
  }

  it('relays a freshly-arrived waybill to the SOURCE and the destination, and persists it', async () => {
    // The #1947 regression test: pre-fix the source could never receive a
    // late-arriving waybill, so the marketplace showed the order as shipped while
    // still asking the seller to add tracking numbers.
    const { carrierConnectionId, shipmentId } = await seedShipment('ol_order_statussync_1', {
      advanceToDispatched: true,
    });

    stubs.carrier.setNextSnapshot({
      status: 'dispatched',
      providerStatus: 'waybill-assigned',
      trackingNumber: 'NEW-WAYBILL',
    });

    const result = await statusSyncService().sync(carrierConnectionId, { limit: 10 });

    expect(result).toMatchObject({ scanned: 1, updated: 1, propagated: 1, failed: 0 });

    // The source received the waybill — the whole point of the fix.
    expect(stubs.source.writebackCalls).toEqual([
      {
        type: 'dispatched',
        externalOrderId: SOURCE_EXTERNAL_ID,
        trackingNumber: 'NEW-WAYBILL',
        carrier: { platformType: STATUS_SYNC_CARRIER_PLATFORM_TYPE },
      },
    ]);

    // The destination still receives it, unchanged in substance: the relay calls
    // `write`, which the adapter delegates to `updateFulfillment`.
    expect(stubs.dest.calls).toEqual([
      {
        externalOrderId: DEST_EXTERNAL_ID,
        status: 'shipped',
        trackingNumber: 'NEW-WAYBILL',
      },
    ]);

    const persisted = await queryService().getById(shipmentId);
    expect(persisted?.trackingNumber).toBe('NEW-WAYBILL');
    expect(persisted?.status).toBe('dispatched');
  });

  it('relays at most once across two consecutive syncs (the claim is consumed)', async () => {
    const { carrierConnectionId } = await seedShipment('ol_order_statussync_claim', {
      advanceToDispatched: true,
    });

    stubs.carrier.setNextSnapshot({
      status: 'dispatched',
      providerStatus: 'waybill-assigned',
      trackingNumber: 'ONCE-ONLY',
    });

    await statusSyncService().sync(carrierConnectionId, { limit: 10 });
    await statusSyncService().sync(carrierConnectionId, { limit: 10 });

    // Second tick: the number is already persisted so the null→value diff no
    // longer fires, and the claim on `waybillRelayedAt` is spent either way.
    expect(stubs.source.writebackCalls).toHaveLength(1);
  });

  it('withholds the tracking number and releases the claim when the SOURCE rejects, so the next tick retries', async () => {
    const { carrierConnectionId, shipmentId } = await seedShipment('ol_order_statussync_2', {
      advanceToDispatched: true,
    });

    stubs.carrier.setNextSnapshot({
      status: 'dispatched',
      providerStatus: 'waybill-assigned',
      trackingNumber: 'RETRY-ME',
    });
    stubs.source.enqueueOutcomes([{ throw: new Error('Allegro unreachable') }]);

    const first = await statusSyncService().sync(carrierConnectionId, { limit: 10 });

    expect(first.updated).toBe(0);
    expect(first.propagated).toBe(0);
    // Handled inside the patch build, so the poll job itself stays healthy.
    expect(first.failed).toBe(0);
    let persisted = await queryService().getById(shipmentId);
    expect(persisted?.trackingNumber).toBeNull();

    // Next tick: the claim was released, so the relay is retried and succeeds.
    stubs.carrier.setNextSnapshot({
      status: 'dispatched',
      providerStatus: 'waybill-assigned',
      trackingNumber: 'RETRY-ME',
    });

    const second = await statusSyncService().sync(carrierConnectionId, { limit: 10 });

    expect(second.propagated).toBe(1);
    persisted = await queryService().getById(shipmentId);
    expect(persisted?.trackingNumber).toBe('RETRY-ME');
    expect(stubs.source.writebackCalls).toHaveLength(2);
  });

  it('at `generated` backfills the tracking number but notifies nobody (deferred to the dispatch path)', async () => {
    const { carrierConnectionId, shipmentId } = await seedShipment('ol_order_statussync_3', {
      advanceToDispatched: false,
    });

    stubs.carrier.setNextSnapshot({
      status: 'generated',
      providerStatus: 'waybill-assigned',
      trackingNumber: 'BACKFILL-ONLY',
    });

    const result = await statusSyncService().sync(carrierConnectionId, { limit: 10 });

    expect(result).toMatchObject({ scanned: 1, updated: 1, propagated: 0 });
    expect(stubs.source.writebackCalls).toHaveLength(0);
    expect(stubs.dest.calls).toHaveLength(0);

    const persisted = await queryService().getById(shipmentId);
    expect(persisted?.trackingNumber).toBe('BACKFILL-ONLY');
    expect(persisted?.status).toBe('generated');
  });
});
