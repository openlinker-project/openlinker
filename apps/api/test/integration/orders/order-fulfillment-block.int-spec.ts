/**
 * Order fulfilment block — single-writer round-trip (#2396)
 *
 * The acceptance criterion this file exists for, stated verbatim in the issue:
 * *"`OrderIngestionService` is the only writer of both columns, and both are
 * absent from `toOrm` — asserted by a test that persists an order carrying a
 * reason and shows a subsequent `persistOrder` does not clear it."*
 *
 * A unit test can assert the columns are absent from the emitted upsert
 * statement, and one does (`order-record.repository.spec.ts`). It cannot show
 * the row SURVIVES, because that is a property of what Postgres does with the
 * statement — `ON CONFLICT DO UPDATE` leaves an unnamed column alone — and the
 * only honest way to demonstrate it is to run the real ingestion write against
 * a real row. So this writes a reason, re-runs `persistOrder`, and reads the
 * columns back.
 *
 * Why it matters: `persistOrder` runs BEFORE the fulfilment intercept on every
 * ingestion. If either column were in the write set, a re-poll would null the
 * reason the previous transition wrote and then re-add none, because the
 * intercept has not run yet — the detecting poll erasing its own finding, the
 * same shape #2140 / #2101 / #1984 / #2100 / #2124 / #2287 each had to undo.
 * The order would read "nothing is wrong" while being held from every
 * destination.
 *
 * Records are written and read through `IOrderRecordService` and the ORM
 * entity, never a `*RepositoryPort` — importing one from `apps/api` is a deny
 * shape in `scripts/check-cross-context-imports.mjs`.
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

const ORDER_ID = 'ol_order_fulfillment_block_test';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: 'ORD-FB-1',
    status: 'pending',
    customerId: null,
    items: [
      {
        id: 'l1',
        productId: 'ol_product_1',
        variantId: 'ol_variant_1',
        quantity: 1,
        price: 10,
        sku: 'SKU-1',
      },
    ],
    totals: { subtotal: 10, tax: 0, shipping: 0, total: 10, currency: 'PLN' },
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as Order;
}

describe('OrderRecord fulfilment block (integration, #2396)', () => {
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

  async function readRow(): Promise<OrderRecordOrmEntity> {
    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    expect(row).not.toBeNull();
    return row as OrderRecordOrmEntity;
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

  it('keeps a written reason across a subsequent persistOrder', async () => {
    const sourceId = await seedOrder();

    await orderRecordService.markFulfillmentBlock(ORDER_ID, {
      reason: 'routing-in-doubt',
      detail: 'decision dec-1 left live for resumption (timeout)',
    });

    // Non-vacuity: if the write itself silently did nothing, the survival
    // assertion below would pass against two nulls and prove exactly nothing.
    const written = await readRow();
    expect(written.fulfillmentBlockReason).toBe('routing-in-doubt');
    expect(written.fulfillmentBlockDetail).toBe(
      'decision dec-1 left live for resumption (timeout)'
    );

    // The ingestion write path, unchanged: re-persist the same order, exactly
    // as a re-poll of an already-ingested order does.
    await orderRecordService.persistOrder(makeOrder({ status: 'processing' }), sourceId, 'evt-2');

    const after = await readRow();
    expect(after.fulfillmentBlockReason).toBe('routing-in-doubt');
    expect(after.fulfillmentBlockDetail).toBe(
      'decision dec-1 left live for resumption (timeout)'
    );
    // The re-ingestion really did write — otherwise the survival above is
    // vacuous for a second reason.
    expect(after.recordStatus).toBe('ready');
  });

  it('clears the reason only through its own writer (level-triggered)', async () => {
    await seedOrder();

    await orderRecordService.markFulfillmentBlock(ORDER_ID, {
      reason: 'routing-contended',
      detail: null,
    });
    expect((await readRow()).fulfillmentBlockReason).toBe('routing-contended');

    // `null` is the ONLY thing that clears it once the condition resolves. A
    // writer that skipped the clear would be sticky — the #2100 lesson.
    await orderRecordService.markFulfillmentBlock(ORDER_ID, null);

    const cleared = await readRow();
    expect(cleared.fulfillmentBlockReason).toBeNull();
    expect(cleared.fulfillmentBlockDetail).toBeNull();
  });

  it('does not touch updatedAt when the value is unchanged', async () => {
    // Every ingestion on every install today writes `null` over `null`, and
    // `updatedAt` is a live filter axis (`FulfillmentStatusSyncService` scans
    // `updatedSince`). An unguarded write would bump every order on every poll
    // and drag them all into that scan.
    await seedOrder();
    const before = (await readRow()).updatedAt;

    await orderRecordService.markFulfillmentBlock(ORDER_ID, null);

    expect((await readRow()).updatedAt.getTime()).toBe(before.getTime());
  });

  // #3455 — the routing-skip reason follows the same single-writer rule.
  it('keeps a recorded routing skip reason across a subsequent persistOrder (#3455)', async () => {
    const sourceId = await seedOrder();

    await orderRecordService.markFulfillmentRoutingSkip(ORDER_ID, 'mirrored-before-routing');
    // Non-vacuity: the write itself must have landed.
    expect((await readRow()).fulfillmentRoutingSkipReason).toBe('mirrored-before-routing');

    await orderRecordService.persistOrder(makeOrder({ status: 'processing' }), sourceId, 'evt-2');

    const after = await readRow();
    expect(after.fulfillmentRoutingSkipReason).toBe('mirrored-before-routing');
    expect(after.recordStatus).toBe('ready');
  });

  it('reads the recorded routing skip reason back onto the domain record (#3455)', async () => {
    await seedOrder();

    await orderRecordService.markFulfillmentRoutingSkip(ORDER_ID, 'own-shop-order');

    const record = await orderRecordService.getOrderRecord(ORDER_ID);
    expect(record?.fulfillmentRoutingSkipReason).toBe('own-shop-order');

    await orderRecordService.markFulfillmentRoutingSkip(ORDER_ID, null);
    expect((await orderRecordService.getOrderRecord(ORDER_ID))?.fulfillmentRoutingSkipReason).toBeNull();
  });

  // #3485 — the block is READ now: an order held in OpenLinker has to say why.
  it('reads the fulfilment block back onto the domain record (#3485)', async () => {
    await seedOrder();

    await orderRecordService.markFulfillmentBlock(ORDER_ID, {
      reason: 'routing-refused',
      detail: 'plan-carries-unfulfillable',
    });

    expect((await orderRecordService.getOrderRecord(ORDER_ID))?.fulfillmentBlock).toEqual({
      reason: 'routing-refused',
      detail: 'plan-carries-unfulfillable',
    });

    await orderRecordService.markFulfillmentBlock(ORDER_ID, null);
    expect((await orderRecordService.getOrderRecord(ORDER_ID))?.fulfillmentBlock).toBeNull();
  });

  // A value written by a newer release and then rolled back must read as "no
  // block", never reach the API as an unknown literal.
  it('reads an unrecognised persisted reason as no block (#3485)', async () => {
    await seedOrder();
    await recordRepo().update(
      { internalOrderId: ORDER_ID },
      { fulfillmentBlockReason: 'routing-from-the-future', fulfillmentBlockDetail: 'x' }
    );

    expect((await orderRecordService.getOrderRecord(ORDER_ID))?.fulfillmentBlock).toBeNull();
  });

  describe('listOrderIdsByFulfillmentBlockReasons (#3485)', () => {
    async function seedHeld(ids: readonly string[], reason: 'routing-refused' | 'routing-failed' | 'routing-no-shipping-address'): Promise<void> {
      const source = await createTestConnection(harness.getDataSource(), {
        platformType: 'allegro',
        name: `Allegro source ${reason}`,
        adapterKey: 'allegro.test.unused',
      });
      for (const id of ids) {
        await orderRecordService.persistOrder(makeOrder({ id, orderNumber: id }), source.id, `evt-${id}`);
        await orderRecordService.markFulfillmentBlock(id, { reason, detail: null });
      }
    }

    it('returns only the requested reasons, ascending by order id', async () => {
      await seedHeld(['ol_order_c', 'ol_order_a'], 'routing-refused');
      await seedHeld(['ol_order_b'], 'routing-failed');
      await seedHeld(['ol_order_d'], 'routing-no-shipping-address');

      const ids = await orderRecordService.listOrderIdsByFulfillmentBlockReasons(
        ['routing-refused', 'routing-failed'],
        { afterOrderId: null, limit: 10 }
      );

      expect(ids).toEqual(['ol_order_a', 'ol_order_b', 'ol_order_c']);
    });

    // Keyset: a page starts strictly after the cursor, so an order re-routed
    // (and therefore removed) between two pages cannot make the next page skip
    // one that is still held — the offset failure mode.
    it('pages strictly after the cursor and skips nothing when a row leaves the set', async () => {
      await seedHeld(['ol_order_a', 'ol_order_b', 'ol_order_c'], 'routing-refused');

      const first = await orderRecordService.listOrderIdsByFulfillmentBlockReasons(
        ['routing-refused'],
        { afterOrderId: null, limit: 2 }
      );
      expect(first).toEqual(['ol_order_a', 'ol_order_b']);

      await orderRecordService.markFulfillmentBlock('ol_order_a', null);

      const second = await orderRecordService.listOrderIdsByFulfillmentBlockReasons(
        ['routing-refused'],
        { afterOrderId: 'ol_order_b', limit: 2 }
      );
      expect(second).toEqual(['ol_order_c']);
    });
  });
});
