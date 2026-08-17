/**
 * Order Record Fulfillment-State Persistence Int-Spec (#2101)
 *
 * Proves that a re-ingestion of the same order cannot reset the fulfillment
 * rollup the shipping context wrote out-of-band. A mocked repository spec can
 * only assert "the property was never set on the ORM entity"; only a real
 * `save()` against Postgres proves TypeORM actually omits the column from the
 * generated `UPDATE` and the committed `'dispatched'` value survives.
 *
 * Also covers the operator-visible consequence: the re-persisted order must not
 * re-enter the not-shipped list filter or its ship-by SLA bucket.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_RECORD_SERVICE_TOKEN,
  deriveSlaState,
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

const PAGE = { limit: 50, offset: 0 };

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'ol_order_fulfillment_state_test',
    orderNumber: 'ORD-FULFILL-1',
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

describe('Order record fulfillment state survives re-ingestion (#2101)', () => {
  let harness: IntegrationTestHarness;
  let orderRecordService: IOrderRecordService;

  beforeAll(async () => {
    harness = await getTestHarness();
    orderRecordService = harness.getApp().get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('keeps a dispatched rollup after a later re-poll of the same order (persistOrder)', async () => {
    const dataSource = harness.getDataSource();
    const recordRepo = dataSource.getRepository(OrderRecordOrmEntity);
    const connection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });

    const order = makeOrder();
    await orderRecordService.persistOrder(order, connection.id, 'evt-1');

    // The shipping context dispatches the order and pushes the rollup.
    await orderRecordService.updateFulfillmentState(order.id, 'dispatched');
    const afterDispatch = await recordRepo.findOne({ where: { internalOrderId: order.id } });
    expect(afterDispatch!.fulfillmentState).toBe('dispatched');

    // A reconciliation poll re-pulls the same order. Its full-object upsert()
    // must not reset the rollup - the ingestion path never carries one.
    await orderRecordService.persistOrder(
      makeOrder({ id: order.id, updatedAt: new Date('2026-08-02T00:00:00Z') }),
      connection.id,
      'evt-2'
    );

    const row = await recordRepo.findOne({ where: { internalOrderId: order.id } });
    expect(row!.fulfillmentState).toBe('dispatched');

    const found = await orderRecordService.getOrderRecord(order.id);
    expect(found!.fulfillmentState).toBe('dispatched');
    // The re-pull still refreshes the columns it does own.
    expect(found!.sourceEventId).toBe('evt-2');
  });

  it('does not reclassify a re-polled dispatched order as not-shipped or SLA-pressured', async () => {
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });

    // A past ship-by deadline: were the rollup reset to NULL, this order would
    // read `not-shipped` and re-enter the `overdue` bucket.
    const dispatchTo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const order = makeOrder({
      id: 'ol_order_fulfillment_sla_test',
      dispatchTime: { to: dispatchTo },
    });

    await orderRecordService.persistOrder(order, connection.id, 'evt-1');
    await orderRecordService.updateFulfillmentState(order.id, 'dispatched');
    await orderRecordService.persistOrder(
      makeOrder({
        id: order.id,
        dispatchTime: { to: dispatchTo },
        updatedAt: new Date('2026-08-02T00:00:00Z'),
      }),
      connection.id,
      'evt-2'
    );

    const notShipped = await orderRecordService.findMany({ fulfillmentState: 'not-shipped' }, PAGE);
    expect(notShipped.items.map((o) => o.internalOrderId)).not.toContain(order.id);

    const overdue = await orderRecordService.findMany({ slaState: 'overdue' }, PAGE);
    expect(overdue.items.map((o) => o.internalOrderId)).not.toContain(order.id);

    const dispatched = await orderRecordService.findMany({ fulfillmentState: 'dispatched' }, PAGE);
    expect(dispatched.items.map((o) => o.internalOrderId)).toContain(order.id);

    // The domain derivation the API response mapper uses agrees with the SQL.
    const found = await orderRecordService.getOrderRecord(order.id);
    expect(deriveSlaState(found!.dispatchByAt, found!.fulfillmentState, new Date())).toBe('none');
  });
});
