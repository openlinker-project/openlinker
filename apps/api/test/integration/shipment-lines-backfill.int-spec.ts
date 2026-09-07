/**
 * `shipment_lines` backfill — the cancel-and-reissue proof (#2727)
 *
 * ## What this asserts, and why the second assertion is the point
 *
 * The acceptance criterion is that the backfill is event-shaped and that a
 * cancel-and-reissue does **not** double-count — *"proven by a test that fails
 * against a snapshot backfill"*.
 *
 * A test that only asserted the correct total would pass against a correct
 * implementation and say nothing about whether the shape mattered. So each case
 * computes BOTH figures from the same rows:
 *
 * - `net`      = `Σ (shippedQuantity − cancelledQuantity)` — what the event fold
 *                produces, and what every derivation reads;
 * - `snapshot` = `Σ shippedQuantity` — precisely what a snapshot backfill would
 *                have written, since it has no `cancel` act to net against.
 *
 * On a cancel-and-reissue order those two DIVERGE, and the test asserts the
 * divergence explicitly. Swap the migration for a snapshot backfill and `net`
 * becomes `snapshot`, which fails.
 *
 * ## Why the real migration rather than the harness
 *
 * The harness builds its schema by TypeORM `synchronize` and runs no
 * migrations, so a harness-based assertion about a BACKFILL is a check that
 * cannot fail — there would be nothing to back-fill from and nothing running.
 * This builds the real chain in a second database, seeds history into it, then
 * runs the backfill migration against that seeded history. The
 * `oms-connection-never-seeded.int-spec.ts` precedent, for the same reason.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';

import { getTestHarness, IntegrationTestHarness, teardownTestHarness } from './setup';

const MIGRATED_DB = 'shipment_lines_backfill';

/** The backfill migration; everything before it builds the schema and history. */
const BACKFILL_MIGRATION = 'BackfillShipmentLines1874000001000';

interface LineTotals {
  readonly net: number;
  readonly snapshot: number;
  readonly delivered: number;
}

describe('shipment_lines backfill (#2727)', () => {
  let harness: IntegrationTestHarness;
  let db: DataSource;

  beforeAll(async () => {
    harness = await getTestHarness();
    const options = harness.getDataSource().options as {
      host: string;
      port: number;
      username: string;
      password: string;
    };

    await harness.getDataSource().query(`DROP DATABASE IF EXISTS "${MIGRATED_DB}"`);
    await harness.getDataSource().query(`CREATE DATABASE "${MIGRATED_DB}"`);

    db = new DataSource({
      type: 'postgres',
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      database: MIGRATED_DB,
      synchronize: false,
      migrationsRun: false,
      entities: [],
      migrations: [`${__dirname}/../../src/migrations/*.ts`],
    });
    await db.initialize();

    // The chain's first migration assumes `uuid-ossp` — a pre-existing defect
    // tracked as #2684, worked around here exactly as the parity spec does.
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // Run every migration UP TO but not including the backfill, so history can
    // be seeded into a schema that already has the tables.
    const all = db.migrations.map((m) => m.name ?? m.constructor.name);
    const backfillIndex = all.indexOf(BACKFILL_MIGRATION);
    expect(backfillIndex).toBeGreaterThan(0);

    // TypeORM has no "run up to N", so run the whole chain (the backfill finds
    // an empty `shipments` table and does nothing), then seed and re-run the
    // backfill by hand — which additionally proves the pass is idempotent.
    await db.runMigrations();
  }, 180000);

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    await harness.getDataSource().query(`DROP DATABASE IF EXISTS "${MIGRATED_DB}"`);
    await teardownTestHarness();
  });

  const seedOrder = async (orderId: string, lineId: string, quantity: number): Promise<void> => {
    await db.query(
      `INSERT INTO "order_records" ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus")
       VALUES ($1, '00000000-0000-0000-0000-000000000001', $2::jsonb, 'ready')
       ON CONFLICT ("internalOrderId") DO UPDATE SET "orderSnapshot" = EXCLUDED."orderSnapshot"`,
      [orderId, JSON.stringify({ items: [{ id: lineId, quantity }] })],
    );
  };

  let shipmentSeq = 0;
  const seedShipment = async (
    orderId: string,
    status: string,
    stamps: { dispatchedAt?: string; cancelledAt?: string; deliveredAt?: string } = {},
  ): Promise<string> => {
    const seq = (shipmentSeq += 1);
    const id = `ol_shipment_seed_${seq}`;
    await db.query(
      `INSERT INTO "shipments"
         ("id","orderId","connectionId","direction","shippingMethod","status",
          "providerShipmentId","dispatchedAt","cancelledAt","deliveredAt","createdAt","updatedAt")
       VALUES ($1,$2,'00000000-0000-0000-0000-000000000002','outbound','courier',$3,$4,$5,$6,$7, now(), now())`,
      [
        id,
        orderId,
        status,
        // A DISTINCT provider id per seeded shipment, and not incidental.
        // `UQ_shipments_branch_one_per_order_conn` (#2373) is
        // `UNIQUE (orderId, connectionId, direction) WHERE "providerShipmentId"
        // IS NULL`, so several NULL-provider rows for one (order, connection,
        // direction) are refused — correctly: a branch-1 row is the ONE observed
        // projection of an OMP-fulfilled order, and there cannot be two.
        //
        // The cancel-and-reissue history this file exists to test is not that
        // shape at all: it is two real dispatched labels, each with its own
        // carrier-assigned id. Seeding it with NULLs modelled the wrong thing
        // AND hit the index.
        `provider-${seq}`,
        stamps.dispatchedAt ?? null,
        stamps.cancelledAt ?? null,
        stamps.deliveredAt ?? null,
      ],
    );
    return id;
  };

  const runBackfill = async (): Promise<void> => {
    const migration = db.migrations.find(
      (m) => (m.name ?? m.constructor.name) === BACKFILL_MIGRATION,
    );
    expect(migration).toBeDefined();
    const runner = db.createQueryRunner();
    try {
      await migration!.up(runner);
    } finally {
      await runner.release();
    }
  };

  const totalsFor = async (orderId: string): Promise<LineTotals> => {
    const rows = (await db.query(
      `SELECT
         COALESCE(SUM("shippedQuantity" - "cancelledQuantity"), 0)::int AS net,
         COALESCE(SUM("shippedQuantity"), 0)::int                        AS snapshot,
         COALESCE(SUM("deliveredQuantity"), 0)::int                      AS delivered
       FROM "shipment_lines" WHERE "orderId" = $1`,
      [orderId],
    )) as { net: number; snapshot: number; delivered: number }[];
    return {
      net: Number(rows[0].net),
      snapshot: Number(rows[0].snapshot),
      delivered: Number(rows[0].delivered),
    };
  };

  it('should NOT double-count a cancel-and-reissue — and diverge from a snapshot backfill', async () => {
    const orderId = 'ol_order_reissue';
    await seedOrder(orderId, 'line-1', 2);
    // S1 dispatched, then cancelled. S2 is the re-issue.
    await seedShipment(orderId, 'cancelled', {
      dispatchedAt: '2026-01-01T10:00:00Z',
      cancelledAt: '2026-01-01T11:00:00Z',
    });
    await seedShipment(orderId, 'dispatched', { dispatchedAt: '2026-01-02T10:00:00Z' });

    await runBackfill();

    const totals = await totalsFor(orderId);

    // The event fold: S1 nets to zero (ship 2, cancel 2), S2 contributes 2.
    expect(totals.net).toBe(2);

    // What a SNAPSHOT backfill would have produced from the same two rows — no
    // `cancel` act to net against, so both shipments claim the full quantity.
    // This is the assertion that makes the test fail against a snapshot
    // implementation rather than merely pass against this one.
    expect(totals.snapshot).toBe(4);
    expect(totals.net).not.toBe(totals.snapshot);
  });

  it('should stay correct across THREE attempts, not just two', async () => {
    const orderId = 'ol_order_three_attempts';
    await seedOrder(orderId, 'line-1', 2);
    await seedShipment(orderId, 'cancelled', {
      dispatchedAt: '2026-02-01T10:00:00Z',
      cancelledAt: '2026-02-01T11:00:00Z',
    });
    await seedShipment(orderId, 'cancelled', {
      dispatchedAt: '2026-02-02T10:00:00Z',
      cancelledAt: '2026-02-02T11:00:00Z',
    });
    await seedShipment(orderId, 'delivered', {
      dispatchedAt: '2026-02-03T10:00:00Z',
      deliveredAt: '2026-02-04T10:00:00Z',
    });

    await runBackfill();

    const totals = await totalsFor(orderId);
    expect(totals.net).toBe(2);
    expect(totals.delivered).toBe(2);
    // A snapshot backfill compounds with every attempt: 3 × 2.
    expect(totals.snapshot).toBe(6);
  });

  it('should emit no acts for a shipment cancelled before it ever shipped', async () => {
    const orderId = 'ol_order_cancelled_draft';
    await seedOrder(orderId, 'line-1', 3);
    // No `dispatchedAt`, and a status that never implies departure.
    await seedShipment(orderId, 'cancelled', { cancelledAt: '2026-03-01T10:00:00Z' });

    await runBackfill();

    const totals = await totalsFor(orderId);
    // Nothing shipped, so there is nothing to reverse — which is what keeps
    // `cancelledQuantity <= shippedQuantity` true.
    expect(totals.net).toBe(0);
    expect(totals.snapshot).toBe(0);
  });

  it('should be idempotent — a re-run changes nothing', async () => {
    const orderId = 'ol_order_idempotent';
    await seedOrder(orderId, 'line-1', 4);
    await seedShipment(orderId, 'delivered', {
      dispatchedAt: '2026-04-01T10:00:00Z',
      deliveredAt: '2026-04-02T10:00:00Z',
    });

    await runBackfill();
    const first = await totalsFor(orderId);

    await runBackfill();
    await runBackfill();
    const third = await totalsFor(orderId);

    expect(third).toEqual(first);
    expect(third.net).toBe(4);

    const actRows = (await db.query(
      `SELECT COUNT(*)::int AS n FROM "shipment_line_events" e
         JOIN "shipment_lines" l ON l."id" = e."shipmentLineId"
        WHERE l."orderId" = $1`,
      [orderId],
    )) as { n: number }[];
    // Exactly one `ship` and one `deliver`, however many times the pass ran.
    expect(Number(actRows[0].n)).toBe(2);
  });

  it('should never touch a return-direction shipment', async () => {
    const orderId = 'ol_order_return_cohort';
    await seedOrder(orderId, 'line-1', 2);
    await db.query(
      `INSERT INTO "shipments"
         ("id","orderId","connectionId","direction","shippingMethod","status","dispatchedAt","createdAt","updatedAt")
       VALUES ('ol_shipment_return_1',$1,'00000000-0000-0000-0000-000000000002','return','courier','dispatched', now(), now(), now())`,
      [orderId],
    );

    await runBackfill();

    const rows = (await db.query(
      `SELECT COUNT(*)::int AS n FROM "shipment_lines" WHERE "shipmentId" = 'ol_shipment_return_1'`,
    )) as { n: number }[];
    expect(Number(rows[0].n)).toBe(0);
  });

  it('should cascade lines and acts away with their shipment', async () => {
    const orderId = 'ol_order_cascade';
    await seedOrder(orderId, 'line-1', 1);
    const shipmentId = await seedShipment(orderId, 'delivered', {
      dispatchedAt: '2026-05-01T10:00:00Z',
      deliveredAt: '2026-05-02T10:00:00Z',
    });

    await runBackfill();

    const before = (await db.query(
      `SELECT COUNT(*)::int AS n FROM "shipment_lines" WHERE "shipmentId" = $1`,
      [shipmentId],
    )) as { n: number }[];
    expect(Number(before[0].n)).toBe(1);

    await db.query(`DELETE FROM "shipments" WHERE "id" = $1`, [shipmentId]);

    const afterLines = (await db.query(
      `SELECT COUNT(*)::int AS n FROM "shipment_lines" WHERE "shipmentId" = $1`,
      [shipmentId],
    )) as { n: number }[];
    expect(Number(afterLines[0].n)).toBe(0);

    // And the act ledger went with the lines — the second CASCADE FK, which
    // `synchronize` never builds and only this spec can exercise.
    const orphanActs = (await db.query(
      `SELECT COUNT(*)::int AS n FROM "shipment_line_events" e
        WHERE NOT EXISTS (SELECT 1 FROM "shipment_lines" l WHERE l."id" = e."shipmentLineId")`,
    )) as { n: number }[];
    expect(Number(orphanActs[0].n)).toBe(0);
  });

  it('should refuse a line whose counters break the capacity invariant', async () => {
    // The DB half of the pure `checkShipmentLineCapacity` twin.
    await expect(
      db.query(
        `INSERT INTO "shipment_lines" ("shipmentId","orderId","lineId","quantity","shippedQuantity","cancelledQuantity")
         VALUES ('ol_shipment_bogus','ol_order_bogus','line-1',5,2,3)`,
      ),
    ).rejects.toThrow(/CHK_shipment_lines_capacity/);
  });
});
