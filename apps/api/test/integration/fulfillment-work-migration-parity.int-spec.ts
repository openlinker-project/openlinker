/**
 * Fulfillment Work — migration/entity parity (#2392, extended #2400)
 *
 * ## The gap this closes
 *
 * The integration harness builds its schema with TypeORM `synchronize`, so
 * every other spec in this repository exercises the ENTITY-derived schema and
 * nothing exercises the migration. `1864000000000-create-fulfillment-works.ts`
 * would otherwise be run by zero automated checks, while five docblocks across
 * the slice assert that its constraints are "declared under the SAME NAME" as
 * the entities'. That is an intention until something compares them.
 *
 * So this spec builds the migration's schema for real — a second database on
 * the same Testcontainers Postgres, with `migrationsRun: true` — and diffs the
 * three tables against the harness's `synchronize`-built ones, column by
 * column, index by index, constraint by constraint.
 *
 * ## What a failure here means
 *
 * Production runs migrations (`synchronize: false`); the tests run
 * `synchronize`. A divergence means the schema under test is not the schema
 * that ships — so a constraint could hold in CI and not in production, or the
 * reverse. That is the failure mode this whole slice's naming discipline exists
 * to prevent, and it is the plan's stated top risk.
 *
 * Scoped deliberately to the `fulfillment_*` tables: a whole-schema diff would
 * fail on pre-existing drift this issue neither caused nor can fix. #2400 added
 * `fulfillment_progress_claims` to the list — in particular this is what proves
 * its composite PRIMARY KEY `(workId, idempotencyKey)` really ships, which the
 * claim repository's bare `ON CONFLICT DO NOTHING` depends on being the table's
 * ONLY uniqueness declaration.
 *
 * **Known dependency**: the `column_default` comparison assumes BOTH databases
 * carry `uuid-ossp`. TypeORM's Postgres driver picks `uuid_generate_v4()` or
 * `gen_random_uuid()` for a generated uuid PK based on what the target database
 * has, so if the harness database ever lacked the extension the two sides would
 * emit different defaults and this file would fail for a reason unrelated to
 * #2392. Stated so that failure is diagnosable rather than mystifying.
 *
 * **Cost**: this runs the FULL migration chain once per integration run, which
 * is why `beforeAll` carries a 180 s budget — the honest price of being the only
 * automated check of a migration anywhere in this repository.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';

import { getTestHarness, IntegrationTestHarness, teardownTestHarness } from './setup';

const TABLES = [
  'fulfillment_works',
  'fulfillment_work_lines',
  'fulfillment_holds',
  // #2400. Extended here rather than given its own parity spec: this file's
  // machinery is already table-driven, and a second file would be a second
  // place for the migration chain to be run (the expensive part) for no gain.
  'fulfillment_progress_claims',
] as const;

const COLUMNS_SQL = `
  SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = ANY($1)
  ORDER BY table_name, column_name`;

// `indexdef` carries uniqueness, column order AND the partial predicate, so one
// string comparison covers everything an index can differ by.
const INDEXES_SQL = `
  SELECT tablename, indexname, indexdef
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = ANY($1)
  ORDER BY tablename, indexname`;

// CHECK and FOREIGN KEY only. PRIMARY KEY is covered by pg_indexes, and NOT NULL
// by information_schema.columns.
const CONSTRAINTS_SQL = `
  SELECT rel.relname AS table_name, con.conname, con.contype,
         pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND rel.relname = ANY($1) AND con.contype IN ('c', 'f')
  ORDER BY rel.relname, con.conname`;

describe('Fulfillment Work — migration/entity schema parity', () => {
  let harness: IntegrationTestHarness;
  let migrated: DataSource;
  const MIGRATED_DB = 'fulfillment_migration_parity';

  beforeAll(async () => {
    harness = await getTestHarness();

    const options = harness.getDataSource().options as {
      host: string;
      port: number;
      username: string;
      password: string;
    };

    // A separate DATABASE rather than a separate schema: migrations write
    // unqualified names, so they must land in their own `public`.
    await harness.getDataSource().query(`DROP DATABASE IF EXISTS "${MIGRATED_DB}"`);
    await harness.getDataSource().query(`CREATE DATABASE "${MIGRATED_DB}"`);

    migrated = new DataSource({
      type: 'postgres',
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      database: MIGRATED_DB,
      // The point of the whole file: build from migrations, never from entities.
      synchronize: false,
      migrationsRun: false,
      entities: [],
      migrations: [`${__dirname}/../../src/migrations/*.ts`],
    });
    await migrated.initialize();

    // ## A pre-existing chain defect, tracked as #2684 — NOT something #2392 owns
    //
    // The FIRST migration (`1766246163229-add-connections-and-mappings`) creates
    // `identifier_mappings` with `DEFAULT uuid_generate_v4()` but never issues
    // `CREATE EXTENSION "uuid-ossp"` — so the chain cannot run against a
    // genuinely empty database. Nothing noticed because no automated path ever
    // ran migrations from empty (the harness uses `synchronize`), and real
    // deployments happen to have the extension already.
    //
    // Creating it here satisfies the precondition without pretending the gap is
    // absent. Fixing migration 1766246163229 is out of scope for this issue — it
    // would rewrite the oldest migration in the tree for a defect this slice did
    // not introduce, and the interesting part needs its own decision: an APPLIED
    // migration never re-runs, so an in-place edit reaches nobody who already
    // deployed. (#2392's own migration does issue the CREATE EXTENSION, which is
    // why it is not implicated.)
    //
    // **Removal condition**: delete this line when #2684 lands. It is a
    // workaround with an owner, not a permanent fixture — left unmarked it would
    // quietly become the reason nobody notices the chain cannot bootstrap.
    await migrated.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    await migrated.runMigrations();
  }, 180000);

  afterAll(async () => {
    if (migrated?.isInitialized) await migrated.destroy();
    await harness.getDataSource().query(`DROP DATABASE IF EXISTS "${MIGRATED_DB}"`);
    await teardownTestHarness();
  });

  const bothSides = async (sql: string): Promise<[unknown[], unknown[]]> => [
    (await harness.getDataSource().query(sql, [[...TABLES]])) as unknown[],
    (await migrated.query(sql, [[...TABLES]])) as unknown[],
  ];

  it('should build every fulfillment table from the migration alone', async () => {
    const rows = (await migrated.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
      [[...TABLES]]
    )) as { table_name: string }[];

    // Non-vacuity for every comparison below: if the migration built nothing,
    // two empty result sets would compare equal and this file would assert
    // nothing at all.
    expect(rows.map((r) => r.table_name)).toEqual([
      'fulfillment_holds',
      'fulfillment_progress_claims',
      'fulfillment_work_lines',
      'fulfillment_works',
    ]);
  });

  it('should agree on every column, type, nullability and default', async () => {
    const [synchronized, fromMigration] = await bothSides(COLUMNS_SQL);
    expect(fromMigration).toEqual(synchronized);
    expect(fromMigration.length).toBeGreaterThan(0);
  });

  it('should agree on every index name, uniqueness, column order and partial predicate', async () => {
    // This is what makes "declared class-level under the SAME NAME the migration
    // uses" an enforced property: an anonymous @Check or a renamed index shows
    // up here as a name mismatch.
    const [synchronized, fromMigration] = await bothSides(INDEXES_SQL);
    expect(fromMigration).toEqual(synchronized);
    expect(fromMigration.length).toBeGreaterThan(0);
  });

  it('should carry the CASCADE foreign keys ONLY in the migration-built schema', async () => {
    // Deliberately an asymmetry assertion rather than a parity one. The FKs are
    // migration-only by design (no `@ManyToOne`), so `synchronize` builds none —
    // which is exactly why CASCADE cannot be exercised by the other int-specs
    // and is verified here instead.
    const [synchronized, fromMigration] = (await bothSides(CONSTRAINTS_SQL)) as [
      { table_name: string; conname: string; contype: string; definition: string }[],
      { table_name: string; conname: string; contype: string; definition: string }[],
    ];

    // NAME **AND** DEFINITION. Comparing names alone was the first version of
    // this, and it is the one comparison in this file carrying a domain
    // invariant rather than an identifier: dropping `"cancelledQuantity" >= 0`
    // from one side leaves both names intact and both schemas "matching" — the
    // exact drift the widened `checkFulfillmentWorkLineCapacity` and this whole
    // spec exist to prevent.
    const checksOf = (rows: { conname: string; contype: string; definition: string }[]): string[] =>
      rows
        .filter((r) => r.contype === 'c')
        .map((r) => `${r.conname} ${r.definition}`)
        .sort();

    // CHECKs come from the entity decorators, so both schemas must carry them.
    expect(checksOf(fromMigration)).toEqual(checksOf(synchronized));
    expect(checksOf(fromMigration).map((entry) => entry.split(' ')[0])).toEqual([
      'CHK_fulfillment_holds_actor',
      'CHK_fulfillment_work_lines_capacity',
    ]);

    // The capacity predicate spelled out clause by clause, so a weakening
    // applied to BOTH sides at once still fails here.
    const capacity = checksOf(fromMigration).find((entry) =>
      entry.startsWith('CHK_fulfillment_work_lines_capacity')
    );
    for (const clause of [
      '"totalQuantity" >= 0',
      '"fulfilledQuantity" >= 0',
      '"cancelledQuantity" >= 0',
      '"totalQuantity"',
    ]) {
      expect(capacity).toContain(clause);
    }

    const foreignKeys = fromMigration.filter((r) => r.contype === 'f');
    expect(foreignKeys.map((r) => r.conname).sort()).toEqual([
      'FK_fulfillment_holds_work',
      'FK_fulfillment_progress_claims_work',
      'FK_fulfillment_work_lines_work',
    ]);
    for (const fk of foreignKeys) {
      expect(fk.definition).toContain('ON DELETE CASCADE');
    }
    // The stated asymmetry, asserted so it cannot silently stop being true.
    expect(synchronized.filter((r) => r.contype === 'f')).toEqual([]);
  });

  it('should delete lines and holds when their parent work is deleted', async () => {
    // CASCADE exercised for real, against the schema that actually ships.
    await migrated.query(
      `INSERT INTO "fulfillment_works"("id","orderId") VALUES ('w-parity','ol_order_parity')`
    );
    await migrated.query(
      `INSERT INTO "fulfillment_work_lines"("fulfillmentWorkId","orderLineId","productVariantId","totalQuantity")
       VALUES ('w-parity','l1','v1',3)`
    );
    await migrated.query(
      `INSERT INTO "fulfillment_holds"("fulfillmentWorkId","reason","placedByService","placedAt")
       VALUES ('w-parity','operator','svc',now())`
    );

    const countChildren = async (): Promise<number> => {
      const [{ total }] = (await migrated.query(
        `SELECT (
           (SELECT count(*) FROM "fulfillment_work_lines" WHERE "fulfillmentWorkId" = 'w-parity') +
           (SELECT count(*) FROM "fulfillment_holds" WHERE "fulfillmentWorkId" = 'w-parity')
         )::int AS total`
      )) as { total: number }[];
      return total;
    };

    expect(await countChildren()).toBe(2);
    await migrated.query(`DELETE FROM "fulfillment_works" WHERE "id" = 'w-parity'`);
    expect(await countChildren()).toBe(0);
  });
});
