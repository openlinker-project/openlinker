/**
 * Order Hold Projection Integration Test (#2340, DESIGN §6.3)
 *
 * Covers the three properties of `order_records.activeHoldReason` that are not
 * properties of any single statement, and therefore cannot be unit-tested:
 *
 * 1. **The single-writer exclusion holds against a real `persistOrder`.** The
 *    column is excluded from BOTH `toOrm` and `upsert()`'s raw column tuple, and
 *    only a real round trip proves the second half — a `toOrm` exclusion alone
 *    would still let the tuple null the reason on every re-poll.
 * 2. **The derived phase reads it, end to end**, through the same column the SQL
 *    twin's `held` arm tests, so the badge and `?phase=held` cannot disagree.
 * 3. **The reconcile repairs BOTH divergence directions** — a missed `place`
 *    write and a missed `release` clear. The second is the one a sweep over open
 *    holds alone would miss, and it is the one that strands an order reading
 *    `held` forever.
 *
 * Written against the SERVICE seams (`IOrderHoldService`,
 * `IOrderRecordService`, `IOrderHoldProjectionReconcileService`) plus direct SQL
 * for the artificial divergence, which is the only way to simulate a write that
 * was missed.
 *
 * @module apps/api/test/integration/orders
 */
import {
  ORDER_HOLD_PROJECTION_RECONCILE_SERVICE_TOKEN,
  ORDER_HOLD_SERVICE_TOKEN,
  ORDER_RECORD_SERVICE_TOKEN,
  type IOrderHoldProjectionReconcileService,
  type IOrderHoldService,
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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ORDER_ID = 'ol_order_hold_projection';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: ORDER_ID,
    orderNumber: 'ORD-HOLD-1',
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

describe('Order hold projection (#2340)', () => {
  let harness: IntegrationTestHarness;
  let holds: IOrderHoldService;
  let records: IOrderRecordService;
  let reconcile: IOrderHoldProjectionReconcileService;
  let sourceId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  beforeEach(async () => {
    const app = harness.getApp();
    holds = app.get<IOrderHoldService>(ORDER_HOLD_SERVICE_TOKEN, { strict: false });
    records = app.get<IOrderRecordService>(ORDER_RECORD_SERVICE_TOKEN, { strict: false });
    reconcile = app.get<IOrderHoldProjectionReconcileService>(
      ORDER_HOLD_PROJECTION_RECONCILE_SERVICE_TOKEN,
      { strict: false }
    );

    const source = await createTestConnection(harness.getDataSource(), {
      platformType: 'allegro',
      name: 'Allegro source',
      adapterKey: 'allegro.test.unused',
    });
    sourceId = source.id;
    await records.persistOrder(makeOrder(), sourceId, 'evt-1');
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

  async function readProjection(): Promise<string | null> {
    const row = await recordRepo().findOne({ where: { internalOrderId: ORDER_ID } });
    return row?.activeHoldReason ?? null;
  }

  /** Simulate a write that was missed — the only way to create real divergence. */
  async function forceProjection(value: string | null): Promise<void> {
    await harness
      .getDataSource()
      .query(`UPDATE "order_records" SET "activeHoldReason" = $1 WHERE "internalOrderId" = $2`, [
        value,
        ORDER_ID,
      ]);
  }

  it('should project the reason on place and clear it on release', async () => {
    const placed = await holds.place({
      internalOrderId: ORDER_ID,
      reason: 'stock-shortfall',
      placedBy: { kind: 'user', userId: 'user-1' },
    });
    await expect(readProjection()).resolves.toBe('stock-shortfall');

    await holds.release({
      holdId: placed.hold.id,
      releasedBy: { kind: 'user', userId: 'user-1' },
    });
    // Level-triggered: storing null is what clears it.
    await expect(readProjection()).resolves.toBeNull();
  });

  it('should NOT clear a hold reason when persistOrder re-ingests the order', async () => {
    // The regression this exists for: `persistOrder` runs on every re-poll with
    // an in-memory record that knows nothing about holds. Excluded from `toOrm`
    // AND from `upsert()`'s raw column tuple — a `toOrm` exclusion alone would
    // still let the tuple null it here.
    await holds.place({
      internalOrderId: ORDER_ID,
      reason: 'fraud-review',
      placedBy: { kind: 'user', userId: 'user-1' },
    });

    await records.persistOrder(makeOrder({ status: 'processing' }), sourceId, 'evt-2');

    await expect(readProjection()).resolves.toBe('fraud-review');
  });

  it('should repair a missed place write', async () => {
    await holds.place({
      internalOrderId: ORDER_ID,
      reason: 'operator',
      placedBy: { kind: 'user', userId: 'user-1' },
    });
    await forceProjection(null);

    await expect(reconcile.runPage(500)).resolves.toMatchObject({
      examined: 1,
      repaired: 1,
      superseded: 0,
      failed: 0,
    });
    await expect(readProjection()).resolves.toBe('operator');
  });

  it('should repair a missed release clear', async () => {
    // The direction a sweep over OPEN HOLDS alone would never see, and the one
    // that leaves an order reading `held` forever.
    await forceProjection('address-invalid');

    await expect(reconcile.runPage(500)).resolves.toMatchObject({
      examined: 1,
      repaired: 1,
    });
    await expect(readProjection()).resolves.toBeNull();
  });

  it('should repair a projection that names the wrong reason', async () => {
    await holds.place({
      internalOrderId: ORDER_ID,
      reason: 'payment-review',
      placedBy: { kind: 'user', userId: 'user-1' },
    });
    await forceProjection('operator');

    await reconcile.runPage(500);

    await expect(readProjection()).resolves.toBe('payment-review');
  });

  it('should clear a persisted value that is no longer in the vocabulary', async () => {
    // Unreachable while `OrderHoldService` is the only writer, but the SQL twin
    // reads `IS NOT NULL` while the TS ladder coerces — so such a row would
    // otherwise derive `held` in the filter and `ready` on the badge, forever.
    await forceProjection('not-a-hold-reason');

    await reconcile.runPage(500);

    await expect(readProjection()).resolves.toBeNull();
  });

  it('should withhold the reconcile clear when a NEW hold carrying the same reason was placed', async () => {
    // The value-based CAS could not see this. The pass witnesses a missed clear
    // at 'operator' and writes null conditioned on `ifCurrentlyIs: 'operator'`;
    // a genuinely NEW 'operator' hold placed in between still matches that
    // witness, so the clear used to erase a LIVE hold and leave the order
    // reading un-held for up to an hour.
    await holds.place({
      internalOrderId: ORDER_ID,
      reason: 'operator',
      placedBy: { kind: 'user', userId: 'user-2' },
    });
    await forceProjection('operator');

    // With a live hold, the pass finds nothing divergent at all — which is one
    // half of the guarantee. The other half is that even when handed the stale
    // witness verbatim, the write itself withholds: run the reconcile's exact
    // clear statement and assert it touches nothing.
    const [rows] = (await harness.getDataSource().query(
      `UPDATE "order_records"
          SET "activeHoldReason" = NULL
        WHERE "internalOrderId" = $1
          AND "activeHoldReason" IS DISTINCT FROM NULL
          AND "activeHoldReason" IS NOT DISTINCT FROM $2
          AND NOT EXISTS (
                SELECT 1 FROM "order_holds" h
                 WHERE h."internalOrderId" = $1
                   AND h."releasedAt" IS NULL
              )
        RETURNING "internalOrderId"`,
      [ORDER_ID, 'operator']
    )) as [unknown[], number];

    expect(rows).toHaveLength(0);
    await expect(readProjection()).resolves.toBe('operator');
  });

  it('should build IDX_order_records_active_hold on activeHoldReason, matching the migration', async () => {
    // The harness builds by `synchronize` (the ENTITY) and production builds by
    // migration, so the same index name was keyed on two different columns —
    // the migration's on `internalOrderId`, i.e. a partial index on the primary
    // key. Asserting both halves in one test is what keeps them from drifting
    // again: the live definition below comes from the entity, the file read
    // comes from the migration.
    const rows = (await harness
      .getDataSource()
      .query(
        `SELECT indexdef FROM pg_indexes
          WHERE tablename = 'order_records' AND indexname = 'IDX_order_records_active_hold'`
      )) as { indexdef: string }[];

    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('activeHoldReason');
    expect(rows[0].indexdef).not.toContain('internalOrderId');

    const migration = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'src',
        'migrations',
        '1855000000000-add-order-record-active-hold-reason.ts'
      ),
      'utf8'
    );
    expect(migration).toContain('ON "order_records" ("activeHoldReason")');
    expect(migration).not.toContain('ON "order_records" ("internalOrderId")');
  });

  it('should find nothing to repair when the projection agrees', async () => {
    await holds.place({
      internalOrderId: ORDER_ID,
      reason: 'operator',
      placedBy: { kind: 'user', userId: 'user-1' },
    });

    await expect(reconcile.runPage(500)).resolves.toEqual({
      examined: 0,
      repaired: 0,
      superseded: 0,
      failed: 0,
    });
  });
});
