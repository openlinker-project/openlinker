/**
 * Source Fulfillment Status Sync → Destination Relay Integration Test
 * (ADR-012 amendment)
 *
 * Proves, against real Postgres, what the unit tests can only mock:
 *
 *   - `SourceFulfillmentStatusSyncService.sync(sourceConnId)` pages the orders
 *     ingested from the source, resolves the source-native order id through the
 *     REAL identifier mappings, reads the source's fulfilment, and writes ONE
 *     source-observed branch-1 `shipments` row - re-running it writes nothing;
 *   - the waybill reaches the destination's `OrderStatusWriteback` exactly once,
 *     with the source excluded as origin, and the `waybillRelayedAt` claim is a
 *     persisted fact;
 *   - OL's own waybill read back from the source mints nothing (echo guard);
 *   - the destination's branch-1 read-back reporting that same parcel back does
 *     NOT relay it to the source again - the loop is closed end to end.
 *
 * The source readback and both writebacks are in-memory stubs registered via
 * the public `AdapterRegistry` + `AdapterFactoryResolver` plugin seams, so the
 * resolution chain (OrderRecord → identifier mapping → adapter) is real while
 * no marketplace is called.
 *
 * @module apps/api/test/integration
 */
import type {
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
} from '@openlinker/core/identifier-mapping';
import type {
  FulfillmentStatusReader,
  FulfillmentStatusSnapshot,
  OrderFulfillmentReadback,
  OrderLifecycleEvent,
  OrderProcessorManagerPort,
  OrderSourcePort,
  OrderStatusWriteback,
  OrderWritebackResult,
  SourceFulfillmentReadback,
} from '@openlinker/core/orders';
import type {
  IFulfillmentStatusSyncService,
  ISourceFulfillmentStatusSyncService,
} from '@openlinker/core/shipping';
import {
  FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN,
  SOURCE_FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN,
} from '@openlinker/core/shipping';
import type { IntegrationTestHarness } from './setup';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { createTestOrderRecord } from './fixtures/order.fixtures';

const SOURCE_ADAPTER_KEY = 'shoper.sourcefulfillment.test.v1';
const DEST_ADAPTER_KEY = 'prestashop.sourcefulfillment.test.v1';
const SOURCE_EXTERNAL_ID = '7001';
const DEST_EXTERNAL_ID = 'ps-order-SRC-1';

interface ShipmentRow {
  connectionId: string;
  trackingNumber: string | null;
  providerShipmentId: string | null;
  status: string;
  waybillRelayedAt: Date | null;
}

describe('Source Fulfillment Status Sync → Destination Relay Integration', () => {
  let harness: IntegrationTestHarness;

  // Suite-scoped stub state: AdapterRegistryService.register throws on a second
  // registration of one adapterKey, so the stubs are installed once and only
  // their scriptable state is reset per test.
  const sourceReads: string[] = [];
  const sourceWrites: OrderLifecycleEvent[] = [];
  const destWrites: OrderLifecycleEvent[] = [];
  let nextReadback: SourceFulfillmentReadback;
  let nextDestSnapshot: FulfillmentStatusSnapshot;

  beforeAll(async () => {
    harness = await getTestHarness();
    const app = harness.getApp();
    const registry = app.get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
    const factories = app.get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

    const applied: OrderWritebackResult = { outcome: 'applied' };
    const sourceStub: OrderSourcePort & OrderFulfillmentReadback & OrderStatusWriteback = {
      listOrderFeed(): Promise<never> {
        return Promise.reject(new Error('source stub: listOrderFeed is not exercised'));
      },
      getOrder(): Promise<never> {
        return Promise.reject(new Error('source stub: getOrder is not exercised'));
      },
      readFulfillment(input: { externalOrderId: string }): Promise<SourceFulfillmentReadback> {
        sourceReads.push(input.externalOrderId);
        return Promise.resolve(nextReadback);
      },
      write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
        sourceWrites.push(event);
        return Promise.resolve(applied);
      },
    };
    const destStub: OrderProcessorManagerPort & OrderStatusWriteback & FulfillmentStatusReader = {
      createOrder(): Promise<never> {
        return Promise.reject(new Error('dest stub: createOrder is not exercised'));
      },
      write(event: OrderLifecycleEvent): Promise<OrderWritebackResult> {
        destWrites.push(event);
        return Promise.resolve(applied);
      },
      getFulfillmentStatus(): Promise<FulfillmentStatusSnapshot> {
        return Promise.resolve(nextDestSnapshot);
      },
    };

    registry.register({
      adapterKey: SOURCE_ADAPTER_KEY,
      platformType: 'shoper',
      supportedCapabilities: ['OrderSource'],
      displayName: 'Shoper source-fulfillment source (integration-test stub)',
      version: '0.0.0-test',
      isDefault: false,
    });
    registry.register({
      adapterKey: DEST_ADAPTER_KEY,
      platformType: 'prestashop',
      supportedCapabilities: ['OrderProcessorManager'],
      displayName: 'PrestaShop source-fulfillment destination (integration-test stub)',
      version: '0.0.0-test',
      isDefault: false,
    });
    factories.registerFactory(SOURCE_ADAPTER_KEY, {
      createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(sourceStub as unknown as T),
    });
    factories.registerFactory(DEST_ADAPTER_KEY, {
      createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(destStub as unknown as T),
    });
  });

  beforeEach(() => {
    sourceReads.length = 0;
    sourceWrites.length = 0;
    destWrites.length = 0;
    nextReadback = {
      outcome: 'read',
      rawStatus: '3',
      dispatched: true,
      waybills: [{ waybill: 'TP-3RD-PARTY-1', carrierName: 'InPost' }],
    };
    nextDestSnapshot = { status: null, trackingNumber: null, deliveredAt: null };
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const sourceSync = (): ISourceFulfillmentStatusSyncService =>
    harness
      .getApp()
      .get<ISourceFulfillmentStatusSyncService>(SOURCE_FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN);
  const destinationSync = (): IFulfillmentStatusSyncService =>
    harness.getApp().get<IFulfillmentStatusSyncService>(FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN);
  const identifierMapping = (): IIdentifierMappingService =>
    harness.getApp().get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);

  const shipmentsFor = async (orderId: string): Promise<ShipmentRow[]> =>
    await harness.getDataSource().query(
      `SELECT "connectionId", "trackingNumber", "providerShipmentId", "status", "waybillRelayedAt"
           FROM shipments WHERE "orderId" = $1 ORDER BY "createdAt" ASC`,
      [orderId]
    );

  /**
   * A source (Shoper) connection, a destination (PrestaShop) connection, BOTH
   * Order identifier mappings - the source one is what the readback is asked
   * with, the destination one is what the relay resolves - and a `ready` order
   * ingested from the source and synced to the destination.
   */
  async function seed(
    internalOrderId: string
  ): Promise<{ sourceConnectionId: string; destConnectionId: string }> {
    const dataSource = harness.getDataSource();
    const source = await createTestConnection(dataSource, {
      platformType: 'shoper',
      name: 'Shoper source',
      adapterKey: SOURCE_ADAPTER_KEY,
      enabledCapabilities: ['OrderSource'],
    });
    const dest = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination',
      adapterKey: DEST_ADAPTER_KEY,
      enabledCapabilities: ['OrderProcessorManager'],
    });
    await identifierMapping().createMapping(
      CORE_ENTITY_TYPE.Order,
      SOURCE_EXTERNAL_ID,
      source.id,
      internalOrderId
    );
    await identifierMapping().createMapping(
      CORE_ENTITY_TYPE.Order,
      DEST_EXTERNAL_ID,
      dest.id,
      internalOrderId
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
    return { sourceConnectionId: source.id, destConnectionId: dest.id };
  }

  it('should write the source-observed row once and relay the waybill to the destination once', async () => {
    const orderId = 'ol_order_srcfulfil_1';
    const { sourceConnectionId } = await seed(orderId);

    const first = await sourceSync().sync(sourceConnectionId, { limit: 50 });
    const second = await sourceSync().sync(sourceConnectionId, { limit: 50 });

    expect(first).toEqual(expect.objectContaining({ created: 1, relayed: 1, failed: 0 }));
    expect(second).toEqual(
      expect.objectContaining({ created: 0, relayed: 0, skipped: 1, failed: 0 })
    );
    // Asked once, with the SOURCE's own id - the re-run never reads it again.
    expect(sourceReads).toEqual([SOURCE_EXTERNAL_ID]);

    const rows = await shipmentsFor(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        connectionId: sourceConnectionId,
        trackingNumber: 'TP-3RD-PARTY-1',
        providerShipmentId: null,
        status: 'dispatched',
      })
    );
    expect(rows[0].waybillRelayedAt).not.toBeNull();

    // The destination heard it once; the source, being the origin, never did.
    expect(destWrites).toEqual([
      {
        type: 'dispatched',
        externalOrderId: DEST_EXTERNAL_ID,
        trackingNumber: 'TP-3RD-PARTY-1',
        carrier: undefined,
      },
    ]);
    expect(sourceWrites).toEqual([]);
  });

  it('should not echo the parcel back to the source when the destination then reports it shipped', async () => {
    const orderId = 'ol_order_srcfulfil_2';
    const { sourceConnectionId, destConnectionId } = await seed(orderId);
    await sourceSync().sync(sourceConnectionId, { limit: 50 });

    // The destination now reports the parcel OL relayed to it.
    nextDestSnapshot = {
      status: 'dispatched',
      trackingNumber: 'TP-3RD-PARTY-1',
      deliveredAt: null,
    };
    const destination = await destinationSync().sync(destConnectionId, { limit: 50 });

    // The destination's own observation is still projected...
    expect(destination.created).toBe(1);
    expect(await shipmentsFor(orderId)).toHaveLength(2);
    // ...but the source, which reported this parcel in the first place, is
    // not told about it again.
    expect(sourceWrites).toEqual([]);
  });

  it('should mint nothing when the waybill the source reports is one OL already holds', async () => {
    const orderId = 'ol_order_srcfulfil_3';
    const { sourceConnectionId } = await seed(orderId);
    // OL bought this label itself and relayed it into the source; the label
    // was later voided, so OL does not count it as a live parcel and reads the
    // source - which still shows the old number.
    await harness.getDataSource().query(
      `INSERT INTO shipments
         ("id", "orderId", "connectionId", "shippingMethod", "status", "providerShipmentId",
          "trackingNumber", "direction", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'kurier', 'cancelled', 'carrier-1', 'OL-TRK-1', 'outbound', now(), now())`,
      ['ol_shipment_srcfulfil_ol', orderId, sourceConnectionId]
    );
    nextReadback = { ...nextReadback, waybills: [{ waybill: 'OL-TRK-1' }] };

    const result = await sourceSync().sync(sourceConnectionId, { limit: 50 });

    expect(sourceReads).toEqual([SOURCE_EXTERNAL_ID]);
    expect(result).toEqual(expect.objectContaining({ created: 0, relayed: 0, skipped: 1 }));
    expect(await shipmentsFor(orderId)).toHaveLength(1);
    expect(destWrites).toEqual([]);
  });
});
