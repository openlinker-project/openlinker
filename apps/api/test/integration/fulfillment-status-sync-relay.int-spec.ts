/**
 * Fulfillment Status Sync → Source Relay Integration Test (#1169 / #1160 / #1170)
 *
 * Proves the branch-1 lifecycle relay reaches a **source** `OrderStatusWriteback`
 * through **real identifier mappings** under Testcontainers — the one thing the
 * unit tests mock. `FulfillmentStatusSyncService.sync(destConnId)`:
 *   - pages the OL Order Records mirrored to the destination OMP connection,
 *   - reads the OMP's branch-1 view via the dest stub's `FulfillmentStatusReader`,
 *   - find-or-creates the branch-1 `Shipment` row, and
 *   - on the FIRST transition into dispatched/delivered (#1160) or cancelled
 *     (#1170) relays the fact to the order's source participant — origin = the
 *     destination connection (excluded), so the source marketplace receives the
 *     `OrderStatusWriteback` event resolved through the order's identifier
 *     mappings.
 *
 * The OMP read + the source writeback are routed to in-memory stubs registered
 * via the public `AdapterRegistry` + `AdapterFactoryResolver` plugin seams, so
 * the resolution chain (OrderRecord → routing → identifier mapping → adapter) is
 * real against Postgres while the marketplace/OMP HTTP calls are not.
 *
 * Covers: dispatch relay (born-dispatched → source `write({dispatched})`), the
 * at-most-once transition gate (re-poll does not re-fire), the cancel relay
 * (#1170), and marketplace-rejection surfacing (a source `rejected` is reported,
 * never silently dropped, and does not break the sync loop).
 *
 * @module apps/api/test/integration
 */
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN,
  IFulfillmentStatusSyncService,
} from '@openlinker/core/shipping';
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  FulfillmentRelayTestStubs,
  installFulfillmentRelayTestStubs,
  RELAY_DEST_ADAPTER_KEY,
  RELAY_SOURCE_ADAPTER_KEY,
} from './helpers/fulfillment-relay-test-stubs.helper';
import { createTestOrderRecord } from './fixtures/order.fixtures';

const SOURCE_EXTERNAL_ID = 'allegro-checkout-REL-1';
const DEST_EXTERNAL_ID = 'ps-order-REL-1';

describe('Fulfillment Status Sync → Source Relay Integration', () => {
  let harness: IntegrationTestHarness;
  let stubs: FulfillmentRelayTestStubs;

  beforeAll(async () => {
    harness = await getTestHarness();
    stubs = installFulfillmentRelayTestStubs(harness);
  });

  beforeEach(() => {
    // Suite-scoped stubs — reset scriptable state + recorded calls per test
    // (resetTestHarness only truncates the database).
    stubs.source.writebackCalls.length = 0;
    stubs.dest.reads.length = 0;
    stubs.source.setNextOutcome('applied');
    stubs.dest.setNextSnapshot({ status: null, trackingNumber: null, deliveredAt: null });
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const syncService = (): IFulfillmentStatusSyncService =>
    harness.getApp().get<IFulfillmentStatusSyncService>(FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN);
  const identifierMapping = (): IIdentifierMappingService =>
    harness.getApp().get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);

  /**
   * Seed the full resolution graph: a source (allegro) connection wired to the
   * writeback stub, a destination (prestashop) OMP connection wired to the
   * fulfillment-reader stub, the Order→source identifier mapping the relay
   * resolves, and an OrderRecord mirrored to the destination (branch-1 by the
   * routing default — no rule = `omp_fulfilled`). Returns the dest connection id.
   */
  async function seed(internalOrderId: string): Promise<{ destConnectionId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: RELAY_SOURCE_ADAPTER_KEY,
      enabledCapabilities: ['OrderSource'],
    });
    const dest = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination OMP',
      adapterKey: RELAY_DEST_ADAPTER_KEY,
      enabledCapabilities: ['OrderProcessorManager'],
    });

    // The relay resolves the source target's external id from this mapping.
    await identifierMapping().createMapping(
      CORE_ENTITY_TYPE.Order,
      SOURCE_EXTERNAL_ID,
      source.id,
      internalOrderId,
    );

    await createTestOrderRecord(dataSource, {
      internalOrderId,
      sourceConnectionId: source.id,
      recordStatus: 'ready',
      orderSnapshot: { items: [] },
      syncStatus: [
        { destinationConnectionId: dest.id, status: 'synced', externalOrderId: DEST_EXTERNAL_ID },
      ],
    });

    return { destConnectionId: dest.id };
  }

  it('relays a born-dispatched branch-1 row to the source via OrderStatusWriteback', async () => {
    const { destConnectionId } = await seed('ol_order_relay_dispatch_1');
    stubs.dest.setNextSnapshot({
      status: 'dispatched',
      trackingNumber: 'PS-TRK-RELAY-1',
      deliveredAt: null,
    });

    const result = await syncService().sync(destConnectionId, { limit: 50 });

    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
    // The relay reached the source through the real Order→source mapping.
    expect(stubs.dest.reads).toEqual([DEST_EXTERNAL_ID]);
    expect(stubs.source.writebackCalls).toEqual([
      { type: 'dispatched', externalOrderId: SOURCE_EXTERNAL_ID, trackingNumber: 'PS-TRK-RELAY-1' },
    ]);
  });

  it('does not re-fire the dispatch relay on an unchanged-status re-poll (at-most-once)', async () => {
    const { destConnectionId } = await seed('ol_order_relay_dispatch_2');
    stubs.dest.setNextSnapshot({
      status: 'dispatched',
      trackingNumber: 'PS-TRK-RELAY-1',
      deliveredAt: null,
    });

    await syncService().sync(destConnectionId, { limit: 50 }); // creates + relays
    await syncService().sync(destConnectionId, { limit: 50 }); // unchanged → no-op

    expect(stubs.source.writebackCalls).toHaveLength(1);
  });

  it('relays a born-cancelled branch-1 row to the source (#1170)', async () => {
    const { destConnectionId } = await seed('ol_order_relay_cancel_1');
    stubs.dest.setNextSnapshot({ status: 'cancelled', trackingNumber: null, deliveredAt: null });

    const result = await syncService().sync(destConnectionId, { limit: 50 });

    expect(result.created).toBe(1);
    expect(stubs.source.writebackCalls).toEqual([
      { type: 'cancelled', externalOrderId: SOURCE_EXTERNAL_ID },
    ]);

    // Re-poll with the unchanged cancelled status does not re-fire.
    await syncService().sync(destConnectionId, { limit: 50 });
    expect(stubs.source.writebackCalls).toHaveLength(1);
  });

  it('surfaces a marketplace rejection without breaking the sync loop (#1170 AC)', async () => {
    const { destConnectionId } = await seed('ol_order_relay_cancel_reject_1');
    stubs.dest.setNextSnapshot({ status: 'cancelled', trackingNumber: null, deliveredAt: null });
    // The source marketplace refuses the cancel (e.g. already shipped).
    stubs.source.setNextOutcome('rejected', 'order already shipped');

    const result = await syncService().sync(destConnectionId, { limit: 50 });

    // The relay attempted the write (surfaced as a logged `rejected` by the relay)
    // and the sync loop completed cleanly — the rejection is neither swallowed as
    // success nor escalated to a record failure.
    expect(stubs.source.writebackCalls).toEqual([
      { type: 'cancelled', externalOrderId: SOURCE_EXTERNAL_ID },
    ]);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(0);
  });
});
