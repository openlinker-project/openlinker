/**
 * Order packed-fact Int-Spec (#2287)
 *
 * The value here is the DB-level guarantee, not mock choreography. Three of the
 * four properties under test are properties of the STATEMENT Postgres runs and
 * cannot be observed against a mocked repository:
 *
 *  - the `packedAt IS NULL` guard, which is what makes a repeat mark preserve
 *    the ORIGINAL actor rather than overwriting it,
 *  - the `packedAt IS NOT NULL` guard on the clear,
 *  - and the `toOrm` exclusion, provable only by writing the packed fact out of
 *    band and then re-running the ingestion upsert against a real row. That is
 *    the highest-risk regression shape in this change: #2140 / #2101 / #1984 /
 *    #2100 / #2124 each had to remove a column an earlier issue re-admitted.
 *
 * Records are read through `IOrderRecordService` and the ORM entity, never a
 * `*RepositoryPort` — importing one from `apps/api` is a deny shape in
 * `scripts/check-cross-context-imports.mjs`.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_RECORD_SERVICE_TOKEN,
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
import { loginAsAdmin } from '../helpers/test-auth.helper';

const ORDER_ID = 'ol_order_packed_test';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: 'ORD-PACK-1',
    status: 'pending',
    customerId: null,
    items: [],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as Order;
}

describe('Order packed fact (#2287)', () => {
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

  function recordRepo() {
    return harness.getDataSource().getRepository(OrderRecordOrmEntity);
  }

  async function seedOrder(): Promise<string> {
    const source = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    await orderRecordService.persistOrder(makeOrder(), source.id, 'evt-1');
    return source.id;
  }

  it('marks an order packed, clears it, and 404s an unknown order over HTTP', async () => {
    await seedOrder();
    const http = harness.getHttp();
    // loginAsAdmin plain-INSERTs a fixed admin user — call it at most once per test.
    const token = await loginAsAdmin(http, harness.getDataSource());

    const marked = await http
      .post(`/v1/orders/${ORDER_ID}/packed`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(marked.body.packedAt).toEqual(expect.any(String));
    expect(marked.body.packedByUserId).toEqual(expect.any(String));

    const firstActor = marked.body.packedByUserId as string;
    const firstStamp = marked.body.packedAt as string;

    // Both columns are really on the row, not merely on the projection.
    const rowAfterMark = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(rowAfterMark!.packedAt).toBeInstanceOf(Date);
    expect(rowAfterMark!.packedByUserId).toBe(firstActor);

    // A repeat mark is an idempotent replay: still 200, and the FIRST stamp and
    // actor survive (the `packedAt IS NULL` guard, not a COALESCE).
    const replay = await http
      .post(`/v1/orders/${ORDER_ID}/packed`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(replay.body.packedAt).toBe(firstStamp);
    expect(replay.body.packedByUserId).toBe(firstActor);

    // The fact reaches the LIST read too — one shared `toDto`.
    const list = await http
      .get('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.items[0].packedAt).toBe(firstStamp);
    expect(list.body.items[0].packedByUserId).toBe(firstActor);

    // Unmark nulls BOTH columns together.
    const cleared = await http
      .delete(`/v1/orders/${ORDER_ID}/packed`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(cleared.body.packedAt).toBeNull();
    expect(cleared.body.packedByUserId).toBeNull();

    const rowAfterClear = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(rowAfterClear!.packedAt).toBeNull();
    expect(rowAfterClear!.packedByUserId).toBeNull();

    // Clearing an already-unpacked order is a no-op, not an error.
    await http
      .delete(`/v1/orders/${ORDER_ID}/packed`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // An unknown order is a 404 on both routes.
    await http
      .post('/v1/orders/ol_order_does_not_exist/packed')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await http
      .delete('/v1/orders/ol_order_does_not_exist/packed')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('preserves the packed fact across a re-ingestion (toOrm exclusion)', async () => {
    const sourceId = await seedOrder();

    // Seed the packed fact out of band — this is what the ingestion upsert must
    // not be able to reach.
    const stamp = new Date('2026-08-05T10:15:00Z');
    await recordRepo().update(
      { internalOrderId: ORDER_ID },
      { packedAt: stamp, packedByUserId: '11111111-1111-1111-1111-111111111111' }
    );

    // Re-ingest the same order with a changed snapshot. The ingestion path's
    // in-memory OrderRecord carries `packedAt: null`, so if either column were
    // mapped in `toOrm` (or added to the upsert statement) this would silently
    // un-pack the order.
    const saved = await orderRecordService.persistOrder(
      makeOrder({ orderNumber: 'ORD-PACK-2', status: 'processing' }),
      sourceId,
      'evt-2'
    );

    // The upsert's documented contract: out-of-band columns read empty on the
    // RETURNING projection, whatever the row holds.
    expect(saved.packedAt).toBeNull();
    expect(saved.packedByUserId).toBeNull();
    expect(saved.orderSnapshot.orderNumber).toBe('ORD-PACK-2');

    // The ROW is what matters, and it is untouched.
    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(row!.packedAt).toEqual(stamp);
    expect(row!.packedByUserId).toBe('11111111-1111-1111-1111-111111111111');

    // A fresh read through the service reports the true value.
    const reread = await orderRecordService.getOrderRecord(ORDER_ID);
    expect(reread!.packedAt).toEqual(stamp);
    expect(reread!.packedByUserId).toBe('11111111-1111-1111-1111-111111111111');
  });
});
