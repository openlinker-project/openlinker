/**
 * Order Cancellation Record State Int-Spec (#1984)
 *
 * Exercises the two real cancellation-observation paths against the real
 * Postgres harness — the layer the unit specs mock. In particular this
 * proves two things the mocked specs cannot:
 *
 * 1. The raw `UPDATE ... SET "cancelledAt" = COALESCE("cancelledAt", $1)`
 *    issued by `OrderRecordRepository.markCancelled` actually round-trips
 *    through the real `cancelledAt` column (added by migration
 *    `1832000000008-add-order-record-cancelled-at.ts`) with the right
 *    quoting/casing, and that a redelivered cancel event or a later re-poll
 *    is a true no-op against real Postgres (first-write-wins).
 * 2. `OrderRecordRepository.upsert()` (a full-object `save()`) never
 *    overwrites `cancelledAt` — verified by round-tripping `persistOrder`
 *    twice for the same order and asserting the second call preserves the
 *    first-observed instant, which is exactly the hazard the `toOrm()`
 *    comment in the repository documents (a mocked repository spec can
 *    assert "the property was never set on the ORM entity", but only a real
 *    `save()` proves TypeORM actually omits the column from the generated
 *    `UPDATE`).
 *
 * @module apps/api/test/integration/orders
 */
import {
  CORE_ENTITY_TYPE,
  IDENTIFIER_MAPPING_SERVICE_TOKEN,
  type IIdentifierMappingService,
} from '@openlinker/core/identifier-mapping';
import {
  ORDER_INGESTION_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderIngestionService,
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
import { createTestOrderRecord } from '../fixtures/order.fixtures';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ol_order_cancellation_test',
    orderNumber: 'ORD-CANCEL-1',
    status: 'cancelled',
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

describe('Order cancellation durably recorded on the record (#1984)', () => {
  let harness: IntegrationTestHarness;
  let ingestion: IOrderIngestionService;
  let identifierMapping: IIdentifierMappingService;
  let orderRecordService: IOrderRecordService;

  beforeAll(async () => {
    harness = await getTestHarness();
    ingestion = harness.getApp().get<IOrderIngestionService>(ORDER_INGESTION_SERVICE_TOKEN);
    identifierMapping = harness
      .getApp()
      .get<IIdentifierMappingService>(IDENTIFIER_MAPPING_SERVICE_TOKEN);
    orderRecordService = harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('durably records a source cancellation via handleSourceCancellation, and a redelivered cancel event leaves the instant unchanged', async () => {
    const dataSource = harness.getDataSource();
    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);

    const connection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });

    const internalOrderId = 'ol_order_cancel_relay_test';
    const externalOrderId = 'allegro-checkout-cancel-1';

    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.Order,
      externalOrderId,
      connection.id,
      internalOrderId
    );

    await createTestOrderRecord(dataSource, {
      internalOrderId,
      sourceConnectionId: connection.id,
      sourceEventId: 'allegro-evt-0',
      orderSnapshot: { status: 'BOUGHT', orderNumber: externalOrderId, items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
    });

    // Act: a source cancel event arrives. No other participant is mapped to
    // this order, so `OrderLifecycleRelay.relay` resolves zero targets and the
    // handler returns cleanly — the interesting assertion is the DB write.
    const firstResult = await ingestion.syncOrderFromSource(
      connection.id,
      externalOrderId,
      'cancel-evt-1',
      'cancelled'
    );
    expect(firstResult).toEqual([]);

    const afterFirst = await recordRepo.findOne({ where: { internalOrderId } });
    expect(afterFirst).not.toBeNull();
    expect(afterFirst!.cancelledAt).not.toBeNull();
    const firstCancelledAt = afterFirst!.cancelledAt;

    // Act: the same cancel event is redelivered (at-least-once delivery is the
    // platform-wide invariant). first-write-wins must leave the instant intact.
    const secondResult = await ingestion.syncOrderFromSource(
      connection.id,
      externalOrderId,
      'cancel-evt-1-redelivered',
      'cancelled'
    );
    expect(secondResult).toEqual([]);

    const afterSecond = await recordRepo.findOne({ where: { internalOrderId } });
    expect(afterSecond!.cancelledAt).toEqual(firstCancelledAt);
  });

  it('does not mark a destination-echo cancellation, leaving cancelledAt null', async () => {
    const dataSource = harness.getDataSource();
    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);

    // Order originated on Allegro; PrestaShop is only a sync destination.
    const allegroConnection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    const prestashopConnection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'PrestaShop destination',
    });

    const internalOrderId = 'ol_order_cancel_echo_test';
    const prestashopOrderId = 'ps-order-9';

    await identifierMapping.createMapping(
      CORE_ENTITY_TYPE.Order,
      prestashopOrderId,
      prestashopConnection.id,
      internalOrderId
    );

    await createTestOrderRecord(dataSource, {
      internalOrderId,
      sourceConnectionId: allegroConnection.id,
      orderSnapshot: { status: 'BOUGHT', items: [] },
      recordStatus: 'ready',
      cancelledAt: null,
    });

    // Act: PrestaShop (a destination, not the source) reports a "cancel" for
    // its own order id — the ADR-017 destination-echo guard must skip it.
    const result = await ingestion.syncOrderFromSource(
      prestashopConnection.id,
      prestashopOrderId,
      'ps-evt-1',
      'cancelled'
    );
    expect(result).toEqual([]);

    const found = await recordRepo.findOne({ where: { internalOrderId } });
    expect(found!.cancelledAt).toBeNull();
  });

  it('preserves the first-observed cancellation instant across a later re-poll of the same order (persistOrder)', async () => {
    const dataSource = harness.getDataSource();
    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);

    const connection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });

    const order = makeOrder({ id: 'ol_order_cancel_persist_test' });

    // First observation: the order's own feed already reports `status:
    // 'cancelled'` (no separate cancel event) — the ordinary persistOrder
    // path, not handleSourceCancellation.
    const firstSaved = await orderRecordService.persistOrder(order, connection.id, 'evt-1');
    expect(firstSaved.cancelledAt).not.toBeNull();
    const firstCancelledAt = firstSaved.cancelledAt;

    // A later reconciliation poll re-pulls the same (still cancelled) order.
    // Its full-object upsert() must not clobber the already-recorded instant.
    const secondSaved = await orderRecordService.persistOrder(
      makeOrder({
        id: order.id,
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      }),
      connection.id,
      'evt-2'
    );
    expect(secondSaved.cancelledAt).toEqual(firstCancelledAt);

    const found = await recordRepo.findOne({ where: { internalOrderId: order.id } });
    expect(found!.cancelledAt).toEqual(firstCancelledAt);
  });
});
