/**
 * Order Early-Cancellation Signal Int-Spec (#2069)
 *
 * Exercises the cancel-before-create race against the real Postgres harness:
 * a source cancellation event that arrives before OpenLinker has ever
 * ingested the order must leave a durable trace, so the later create/sync
 * job observes it and skips destination provisioning
 * (`OrderSyncService`'s `#2284` `cancelledAt IS NULL` guard) instead of
 * provisioning the order as active.
 *
 * Registers minimal inline `OrderSourcePort` / `OrderProcessorManagerPort`
 * stubs via the same `AdapterRegistryService` + `AdapterFactoryResolverService`
 * seam real integrations use — mirroring `allegro-test-source-stub.helper.ts`
 * and `fulfillment-relay-test-stubs.helper.ts`'s `destStub` shape (minus the
 * sub-capability the latter needs and this spec doesn't). Both stubs are
 * registered per-test, keyed by the test's own `externalOrderId`, so two
 * tests in this file never collide on `AdapterRegistryService`'s
 * one-registration-per-key rule.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  ADAPTER_REGISTRY_TOKEN,
  AdapterFactoryResolverService,
  AdapterRegistryPort,
} from '@openlinker/core/integrations';
import {
  ORDER_INGESTION_SERVICE_TOKEN,
  type IOrderIngestionService,
  type IncomingOrder,
  type OrderCreate,
  type OrderProcessorManagerPort,
  type OrderRef,
  type OrderSourcePort,
} from '@openlinker/core/orders';
import {
  OrderCancellationSignalOrmEntity,
  OrderRecordOrmEntity,
} from '@openlinker/core/orders/orm-entities';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';

const DEST_ADAPTER_KEY = 'test.orderprocessor.earlycancel.v1';
const DEST_PLATFORM_TYPE = 'prestashop';

function makeIncomingOrder(externalOrderId: string): IncomingOrder {
  return {
    externalOrderId,
    orderNumber: `ORD-${externalOrderId}`,
    status: 'pending',
    items: [],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

/** Registers a per-test `OrderSourcePort` stub returning a fixed IncomingOrder. */
function registerSourceStub(
  harness: IntegrationTestHarness,
  externalOrderId: string,
  incoming: IncomingOrder
): string {
  const adapterKey = `test.ordersource.earlycancel.${externalOrderId}`;
  const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
  const factoryResolver = harness
    .getApp()
    .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

  const stub: OrderSourcePort = {
    listOrderFeed: () => Promise.resolve({ items: [], nextCursor: null }),
    getOrder: () => Promise.resolve(incoming),
  };

  adapterRegistry.register({
    adapterKey,
    platformType: 'allegro',
    supportedCapabilities: ['OrderSource'],
    displayName: `Early-cancel test source (${externalOrderId})`,
    version: '0.0.0-test',
    isDefault: false,
  });
  factoryResolver.registerFactory(adapterKey, {
    createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(stub as unknown as T),
  });

  return adapterKey;
}

describe('Order early-cancellation signal (#2069)', () => {
  let harness: IntegrationTestHarness;
  let ingestion: IOrderIngestionService;
  let createOrderCalls: OrderCreate[];

  beforeAll(async () => {
    harness = await getTestHarness();
    ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);

    const adapterRegistry = harness.getApp().get<AdapterRegistryPort>(ADAPTER_REGISTRY_TOKEN);
    const factoryResolver = harness
      .getApp()
      .get<AdapterFactoryResolverService>(ADAPTER_FACTORY_RESOLVER_TOKEN);

    createOrderCalls = [];
    const destStub: OrderProcessorManagerPort = {
      createOrder(command: OrderCreate): Promise<OrderRef> {
        createOrderCalls.push(command);
        return Promise.resolve({ orderId: 'dest-order-1' });
      },
    };

    adapterRegistry.register({
      adapterKey: DEST_ADAPTER_KEY,
      platformType: DEST_PLATFORM_TYPE,
      supportedCapabilities: ['OrderProcessorManager'],
      displayName: 'Early-cancel test destination',
      version: '0.0.0-test',
      isDefault: false,
    });
    factoryResolver.registerFactory(DEST_ADAPTER_KEY, {
      createCapabilityAdapter: <T>(): Promise<T> => Promise.resolve(destStub as unknown as T),
    });
  });

  beforeEach(() => {
    createOrderCalls.length = 0;
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('cancel arrives first, then the sync job runs: no destination order is created', async () => {
    const dataSource = harness.getDataSource();
    const signalRepo = dataSource.getRepository(OrderCancellationSignalOrmEntity);
    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);
    const mappingRepo = dataSource.getRepository(IdentifierMappingOrmEntity);

    const externalOrderId = 'early-cancel-race-1';
    const sourceAdapterKey = registerSourceStub(
      harness,
      externalOrderId,
      makeIncomingOrder(externalOrderId)
    );

    const sourceConnection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: sourceAdapterKey,
      enabledCapabilities: ['OrderSource'],
    });
    await createTestConnection(dataSource, {
      platformType: DEST_PLATFORM_TYPE,
      name: 'Destination',
      adapterKey: DEST_ADAPTER_KEY,
      enabledCapabilities: ['OrderProcessorManager'],
    });

    // Act 1: the cancel event arrives before the order has ever been
    // ingested — no identifier mapping exists yet.
    const beforeCancel = new Date();
    const cancelResult = await ingestion.syncOrderFromSource(
      sourceConnection.id,
      externalOrderId,
      'cancel-evt-1',
      'cancelled'
    );
    const afterCancel = new Date();
    expect(cancelResult).toEqual([]);

    const mappingAfterCancel = await mappingRepo.findOne({
      where: {
        entityType: 'Order',
        externalId: externalOrderId,
        connectionId: sourceConnection.id,
      },
    });
    expect(mappingAfterCancel).toBeNull();

    const signalAfterCancel = await signalRepo.findOne({
      where: { sourceConnectionId: sourceConnection.id, externalOrderId },
    });
    expect(signalAfterCancel).not.toBeNull();
    // The signal carries the instant the cancel-handling branch stamped
    // (`new Date()` at the time of the call), not a sentinel — pin the value
    // rather than only its non-nullness.
    expect(signalAfterCancel!.cancelledAt.getTime()).toBeGreaterThanOrEqual(
      beforeCancel.getTime()
    );
    expect(signalAfterCancel!.cancelledAt.getTime()).toBeLessThanOrEqual(afterCancel.getTime());

    // Act 2: the create/sync job now runs — the ordinary path, no eventType.
    const syncResult = await ingestion.syncOrderFromSource(
      sourceConnection.id,
      externalOrderId,
      'create-evt-1'
    );

    expect(syncResult).toHaveLength(1);
    expect(syncResult[0].status).toBe('skipped_cancelled');
    expect(createOrderCalls).toHaveLength(0);

    const mappingAfterSync = await mappingRepo.findOne({
      where: {
        entityType: 'Order',
        externalId: externalOrderId,
        connectionId: sourceConnection.id,
      },
    });
    expect(mappingAfterSync).not.toBeNull();

    const record = await recordRepo.findOne({
      where: { internalOrderId: mappingAfterSync!.internalId },
    });
    // Pin the VALUE, not just non-nullness: `cancelledAt` must be the
    // signal's own consumed instant (`earlySignalAt`), never `now` at
    // ingestion time — proving `consume()`'s returned timestamp actually
    // reached `markCancelled` rather than merely triggering it.
    expect(record!.cancelledAt).not.toBeNull();
    expect(record!.cancelledAt!.getTime()).toBe(signalAfterCancel!.cancelledAt.getTime());

    const signalAfterSync = await signalRepo.findOne({
      where: { sourceConnectionId: sourceConnection.id, externalOrderId },
    });
    expect(signalAfterSync).toBeNull();

    // Act 3: a THIRD poll, after the signal has already been consumed and the
    // source's order resource is still lagging (`incoming.status: 'pending'`
    // from `makeIncomingOrder`, unchanged). `persistIncomingSnapshot` no longer
    // has a signal to consume, so `snapshotRecord.cancelledAt` alone would read
    // `null` here (`upsert()`'s `fromRawRow` excludes `cancelledAt` from its
    // write set on this non-writing path) — this is the exact regression the
    // #2069 re-review found: without the `existing.cancelledAt` fallback in
    // `OrderIngestionService`, this poll would silently re-provision an order
    // OL already recorded as cancelled.
    const thirdPoll = await ingestion.syncOrderFromSource(
      sourceConnection.id,
      externalOrderId,
      'create-evt-2'
    );

    expect(thirdPoll).toHaveLength(1);
    expect(thirdPoll[0].status).toBe('skipped_cancelled');
    expect(createOrderCalls).toHaveLength(0);

    const recordAfterThirdPoll = await recordRepo.findOne({
      where: { internalOrderId: mappingAfterSync!.internalId },
    });
    expect(recordAfterThirdPoll!.cancelledAt).not.toBeNull();
    expect(recordAfterThirdPoll!.cancelledAt!.getTime()).toBe(
      signalAfterCancel!.cancelledAt.getTime()
    );
  });

  // #2069 review — the exact race the signal exists for: the source's order
  // RESOURCE still reports its pre-cancel status when the sync job's
  // `getOrder` runs (the event journal that produced the signal leads the
  // resource), so a downstream gate keyed on `incoming.status`/`order.status`
  // alone must not be trusted once the signal is consumed. Pinned at the unit
  // level in `order-ingestion.service.spec.ts` ("should not reserve, and
  // should enqueue stock-restore, when the incoming status still lags a
  // consumed early-cancellation signal") against `reservationService` and
  // `jobQueue` mocks — this harness's real Redis-stream job queue and
  // `IReservationService` binding are not wired to observe those effects
  // directly here.

  it('normal ordering unchanged: create arrives first, no prior cancel — destination order IS created', async () => {
    const dataSource = harness.getDataSource();
    const signalRepo = dataSource.getRepository(OrderCancellationSignalOrmEntity);

    const externalOrderId = 'no-early-cancel-1';
    const sourceAdapterKey = registerSourceStub(
      harness,
      externalOrderId,
      makeIncomingOrder(externalOrderId)
    );

    const sourceConnection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: sourceAdapterKey,
      enabledCapabilities: ['OrderSource'],
    });
    await createTestConnection(dataSource, {
      platformType: DEST_PLATFORM_TYPE,
      name: 'Destination',
      adapterKey: DEST_ADAPTER_KEY,
      enabledCapabilities: ['OrderProcessorManager'],
    });

    const syncResult = await ingestion.syncOrderFromSource(
      sourceConnection.id,
      externalOrderId,
      'create-evt-1'
    );

    expect(syncResult).toHaveLength(1);
    expect(syncResult[0].status).toBe('success');
    expect(createOrderCalls).toHaveLength(1);

    const signalRow = await signalRepo.findOne({
      where: { sourceConnectionId: sourceConnection.id, externalOrderId },
    });
    expect(signalRow).toBeNull();
  });

  // #2069 review — `ON CONFLICT DO NOTHING` is the port's stated first-write-
  // wins guarantee, but nothing previously called `record()` twice for the
  // same key against real Postgres: the unit spec mocks `Repository.query`
  // to resolve, which asserts nothing about the conflict clause and would
  // pass identically against a plain `INSERT`.
  it('first-write-wins: two cancel events for the same order keep the EARLIER cancelledAt', async () => {
    const dataSource = harness.getDataSource();
    const signalRepo = dataSource.getRepository(OrderCancellationSignalOrmEntity);
    const externalOrderId = 'early-cancel-repeat-1';
    const sourceAdapterKey = registerSourceStub(
      harness,
      externalOrderId,
      makeIncomingOrder(externalOrderId)
    );

    const sourceConnection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: sourceAdapterKey,
      enabledCapabilities: ['OrderSource'],
    });

    const firstCancel = await ingestion.syncOrderFromSource(
      sourceConnection.id,
      externalOrderId,
      'cancel-evt-1',
      'cancelled'
    );
    expect(firstCancel).toEqual([]);

    const signalAfterFirst = await signalRepo.findOne({
      where: { sourceConnectionId: sourceConnection.id, externalOrderId },
    });
    expect(signalAfterFirst).not.toBeNull();

    // Force the two calls' `new Date()` stamps onto DISTINCT milliseconds —
    // without this, two `ingestion.syncOrderFromSource` calls back-to-back can
    // land in the same millisecond, and the equality assertion below would
    // pass trivially (by timestamp coincidence) even against a `DO UPDATE`
    // that overwrote the row with the second cancel's instant.
    await new Promise((resolve) => setTimeout(resolve, 5));

    // A second, later-arriving cancel event for the SAME
    // (sourceConnectionId, externalOrderId) — e.g. a duplicate delivery or a
    // reconciliation poll re-observing the cancel. `ON CONFLICT DO NOTHING`
    // must leave the row — and its earlier `cancelledAt` — untouched.
    const secondCancel = await ingestion.syncOrderFromSource(
      sourceConnection.id,
      externalOrderId,
      'cancel-evt-2',
      'cancelled'
    );
    expect(secondCancel).toEqual([]);

    const signalAfterSecond = await signalRepo.findOne({
      where: { sourceConnectionId: sourceConnection.id, externalOrderId },
    });
    expect(signalAfterSecond).not.toBeNull();
    expect(signalAfterSecond!.id).toBe(signalAfterFirst!.id);
    expect(signalAfterSecond!.cancelledAt.getTime()).toBe(
      signalAfterFirst!.cancelledAt.getTime()
    );
  });
});
