/**
 * Order Record Sync-State Persistence Int-Spec (#2140)
 *
 * Proves that a re-ingestion of the same order cannot wipe the destination sync
 * state `updateSyncStatus` wrote out-of-band. A mocked repository spec can only
 * assert "the property was never set on the ORM entity"; only a real `save()`
 * against Postgres proves TypeORM actually omits both columns from the
 * generated statement, that the committed values survive, and that a first-time
 * insert still resolves the omitted columns to an empty array.
 *
 * That last assertion exercises the **ORM decorator** default, not the
 * migration's. The harness builds its schema with TypeORM `synchronize`
 * (`libs/shared/src/database/database.module.ts` enables it for every
 * `NODE_ENV !== 'production'`; `libs/test-kit/src/harness.ts` calls it the
 * "synchronize-built test schema"), so `default: () => "'[]'"` on
 * `order-record.orm-entity.ts` is what fills the column here - which makes
 * that decorator required for this suite to pass, not a cosmetic drift fix.
 * Nothing in CI covers the migration-built schema; its default is asserted by
 * `1833000000005-set-order-records-sync-status-default.ts` and verified only
 * by reading.
 *
 * Also covers the operator-facing consequence: the failed -> retried -> synced
 * narrative the activity timeline renders survives the re-ingestion an operator
 * retry itself triggers, and the retry action no longer 404s on an order that
 * has just been re-ingested.
 *
 * Records are read through `IOrderRecordService`, never a `*RepositoryPort` -
 * importing one from `apps/api` is a deny shape in
 * `scripts/check-cross-context-imports.mjs`.
 *
 * @module apps/api/test/integration/orders
 */
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  ORDER_DESTINATION_RETRY_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  OrderDestinationNotRetryableException,
  type IOrderDestinationRetryService,
  type IOrderRecordService,
  type Order,
} from '@openlinker/core/orders';
import { OrderRecordOrmEntity } from '@openlinker/core/orders/orm-entities';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ol_order_sync_state_test',
    orderNumber: 'ORD-SYNC-1',
    status: 'pending',
    customerId: null,
    items: [],
    totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
    shippingAddress: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      address1: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
    billingAddress: {
      firstName: 'Jan',
      lastName: 'Kowalski',
      address1: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as Order;
}

describe('Order record sync state survives re-ingestion (#2140)', () => {
  let harness: IntegrationTestHarness;
  let orderRecordService: IOrderRecordService;
  let retryService: IOrderDestinationRetryService;
  let identifierMapping: IIdentifierMappingService;

  beforeAll(async () => {
    harness = await getTestHarness();
    orderRecordService = harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
    retryService = harness
      .getApp()
      .get<IOrderDestinationRetryService>(ORDER_DESTINATION_RETRY_SERVICE_TOKEN);
    identifierMapping = harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('keeps a committed syncStatus and syncAttempts history after a later re-poll of the same order', async () => {
    const dataSource = harness.getDataSource();
    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination',
    });

    const order = makeOrder();

    // First persist: the row is INSERTed with both columns omitted from the
    // statement, so Postgres has to fill them from their column DEFAULT. A
    // failure here would mean the insert never reached the default at all.
    await orderRecordService.persistOrder(order, source.id, 'evt-1');
    const afterInsert = await recordRepo.findOne({ where: { internalOrderId: order.id } });
    expect(afterInsert).not.toBeNull();
    expect(afterInsert!.syncStatus).toEqual([]);
    expect(afterInsert!.syncAttempts).toEqual([]);

    // The order sync runs and writes its per-destination state out-of-band:
    // one failed attempt, then a successful one.
    await orderRecordService.updateSyncStatus(order.id, destination.id, {
      destinationConnectionId: destination.id,
      status: 'failed',
      error: 'destination timeout',
    });
    await orderRecordService.updateSyncStatus(order.id, destination.id, {
      destinationConnectionId: destination.id,
      status: 'synced',
      syncedAt: new Date('2026-08-01T10:00:00Z'),
      externalOrderId: 'ps-order-9',
      externalOrderNumber: 'PS-9',
    });

    // A reconciliation poll re-pulls the same order. Its full-object upsert()
    // must not reset either column - the ingestion path never carries one.
    await orderRecordService.persistOrder(
      makeOrder({ id: order.id, updatedAt: new Date('2026-08-02T00:00:00Z') }),
      source.id,
      'evt-2'
    );

    const row = await recordRepo.findOne({ where: { internalOrderId: order.id } });
    // syncStatus keeps its single per-destination current-state row.
    expect(row!.syncStatus).toHaveLength(1);
    expect(row!.syncStatus[0].destinationConnectionId).toBe(destination.id);
    expect(row!.syncStatus[0].status).toBe('synced');
    expect(row!.syncStatus[0].externalOrderId).toBe('ps-order-9');
    // syncAttempts keeps the whole append-only history, in order.
    expect(row!.syncAttempts.map((a) => a.status)).toEqual(['failed', 'synced']);
    expect(row!.syncAttempts[0].error).toBe('destination timeout');

    const found = await orderRecordService.getOrderRecord(order.id);
    expect(found!.syncStatus).toHaveLength(1);
    expect(found!.syncAttempts).toHaveLength(2);
    // The re-pull still refreshes the columns it does own.
    expect(found!.sourceEventId).toBe('evt-2');
  });

  it('keeps the failed -> retried -> synced narrative and the retryable destination row across the retry re-ingestion', async () => {
    const dataSource = harness.getDataSource();
    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);
    const source = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination',
    });

    const order = makeOrder({ id: 'ol_order_sync_state_retry_test' });
    const externalOrderId = 'allegro-checkout-retry-1';

    await orderRecordService.persistOrder(order, source.id, 'evt-1');
    // The retry resolves the source-native id off the order's own mapping.
    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.Order,
      externalOrderId,
      source.id,
      order.id
    );

    await orderRecordService.updateSyncStatus(order.id, destination.id, {
      destinationConnectionId: destination.id,
      status: 'failed',
      error: 'destination timeout',
    });

    // Operator clicks retry: the destination row is claimed (failed -> pending,
    // appending a `pending` attempt) and a marketplace.order.sync job enqueued.
    await retryService.retry({
      internalOrderId: order.id,
      destinationConnectionId: destination.id,
    });

    // That job re-ingests the order, which is exactly the write that used to
    // erase both the original failure and the pending claim.
    await orderRecordService.persistOrder(
      makeOrder({ id: order.id, updatedAt: new Date('2026-08-02T00:00:00Z') }),
      source.id,
      'evt-2'
    );

    const row = await recordRepo.findOne({ where: { internalOrderId: order.id } });
    expect(row!.syncAttempts.map((a) => a.status)).toEqual(['failed', 'pending']);
    expect(row!.syncAttempts[0].error).toBe('destination timeout');
    expect(row!.syncStatus).toHaveLength(1);
    expect(row!.syncStatus[0].status).toBe('pending');

    // The retry action no longer 404s on a just-re-ingested order: the
    // destination row is found, so the refusal is the honest
    // "already in flight" one (OrderDestinationNotRetryableException) rather
    // than "no such destination" (OrderDestinationNotFoundException, mapped to
    // HTTP 404) - the two are unrelated Error subclasses, so asserting the
    // former rules out the latter.
    await expect(
      retryService.retry({
        internalOrderId: order.id,
        destinationConnectionId: destination.id,
      })
    ).rejects.toBeInstanceOf(OrderDestinationNotRetryableException);

    // The re-ingested sync then succeeds and appends its own entry. This is
    // the state the bug actually destroyed: it is only at `synced` that the
    // timeline used to render a lone success with both earlier entries gone.
    await orderRecordService.updateSyncStatus(order.id, destination.id, {
      destinationConnectionId: destination.id,
      status: 'synced',
      syncedAt: new Date('2026-08-02T10:00:00Z'),
      externalOrderId: 'ps-order-retry-9',
    });

    const settled = await recordRepo.findOne({ where: { internalOrderId: order.id } });
    expect(settled!.syncAttempts.map((a) => a.status)).toEqual(['failed', 'pending', 'synced']);
    expect(settled!.syncAttempts[0].error).toBe('destination timeout');
    expect(settled!.syncStatus).toHaveLength(1);
    expect(settled!.syncStatus[0].status).toBe('synced');
    expect(settled!.syncStatus[0].externalOrderId).toBe('ps-order-retry-9');
  });
});
