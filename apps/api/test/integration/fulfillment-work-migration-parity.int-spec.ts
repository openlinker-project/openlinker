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

// Every fulfillment table joins this one spec rather than getting a sibling:
// the file already runs the FULL migration chain once per integration run — the
// expensive part — so each extra table costs one more row in three cheap
// catalogue queries. `routing_decisions` (#2394) in particular carries a PARTIAL
// UNIQUE index, which is exactly what `indexdef` comparison exists to catch: a
// predicate differing between the migration and the entity would let that guard
// hold in production and silently not in tests.
const TABLES = [
  'fulfillment_works',
  'fulfillment_work_lines',
  'fulfillment_holds',
  // #2399's append-only rejection ledger.
  'fulfillment_work_rejections',
  'fulfillment_progress_claims',
  'routing_decisions',
  // Waves 1b/1c/2, added under review of PR #2675: their migrations were as
  // unexercised as the fulfilment ones were before #2392 - the harness builds
  // by `synchronize`, so nothing had ever run them. They cost one row each in
  // the three catalogue queries, which is why they join this file rather than
  // getting a sibling that would re-run the whole chain.
  'inventory_locations',
  'returns',
  'return_lines',
  'return_line_events',
  'order_holds',
  'order_changes',
  'reservations',
  'reservation_shortfall_episodes',
  'automation_rules',
  'automation_runs',
  'automation_trigger_firings',
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

  it('should build every declared table from the migration alone', async () => {
    const rows = (await migrated.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
      [[...TABLES]]
    )) as { table_name: string }[];

    // Non-vacuity for every comparison below: if the migration built nothing,
    // two empty result sets would compare equal and this file would assert
    // nothing at all.
    //
    // DERIVED from `TABLES` rather than restated as literals (#2394). The
    // hardcoded name list was a trap, and #2400 walked into it: extending
    // `TABLES` left this assertion silently claiming the old set, so the FIRST
    // thing adding a table did was fail here for a reason unrelated to the
    // schema it was checking. Deriving it means the next table costs one line.
    expect(rows.map((r) => r.table_name)).toEqual([...TABLES].sort());
  });

  /**
   * #2395's column, checked NARROWLY rather than by adding `order_records` to
   * `TABLES`.
   *
   * That was tried first and is the better shape when it works — the list drives
   * a derived assertion, so a new TABLE costs one line. It does not work here:
   * `order_records` is a long-lived table whose INDEX and FOREIGN-KEY definitions
   * already differ between the `synchronize`-built and migration-built schemas,
   * so adding it fails two assertions for pre-existing drift this issue neither
   * caused nor can fix — precisely the whole-schema-diff problem this file's
   * header says it is scoped to avoid. Its COLUMN comparison passed, which is
   * the half that matters for a new column, so that half is asserted directly.
   *
   * The check is still real: `1868000000000-add-order-shipping-address-hash.ts`
   * is the only thing that creates this column in the migrated database, and
   * nothing but the ORM entity creates it in the harness's.
   */
  it('should build order_records.shippingAddressHash identically from the migration (#2395)', async () => {
    const sql = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_records'
        AND column_name = 'shippingAddressHash'`;

    const fromMigration = (await migrated.query(sql)) as unknown[];
    const synchronized = (await harness.getDataSource().query(sql)) as unknown[];

    // Non-vacuity: two empty result sets would compare equal and assert nothing.
    expect(fromMigration).toHaveLength(1);
    expect(fromMigration).toEqual(synchronized);
    expect(fromMigration[0]).toMatchObject({ is_nullable: 'YES' });
  });

  /**
   * #2396's two columns, checked by the same NARROW shape #2395 established
   * directly above — and for the same reason, restated so the next reader does
   * not "fix" it by extending `TABLES`: `order_records` carries pre-existing
   * index/FK drift between the `synchronize`-built and migration-built schemas,
   * so adding it to the list fails on drift this issue neither caused nor can
   * fix. The COLUMN half is the half a new column needs, and it is asserted here.
   *
   * `1870000000000-add-order-fulfillment-block.ts` is the only thing that
   * creates these columns in the migrated database; nothing but the ORM entity
   * creates them in the harness's.
   */
  it('should build both order_records fulfillmentBlock columns identically from the migration (#2396)', async () => {
    const sql = `
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_records'
        AND column_name IN ('fulfillmentBlockReason', 'fulfillmentBlockDetail')
      ORDER BY column_name`;

    const fromMigration = (await migrated.query(sql)) as unknown[];
    const synchronized = (await harness.getDataSource().query(sql)) as unknown[];

    // Non-vacuity: two empty result sets would compare equal and assert nothing.
    expect(fromMigration).toHaveLength(2);
    expect(fromMigration).toEqual(synchronized);
    // Both nullable, and both `text` — an existing install must be able to
    // upgrade past this migration without a backfill, and every row starts with
    // no reason because nothing was held before the intercept existed.
    for (const column of fromMigration as { is_nullable: string; data_type: string }[]) {
      expect(column).toMatchObject({ is_nullable: 'YES', data_type: 'text' });
    }
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
    //
    // ## The one carve-out: the PRIMARY KEY constraint's NAME
    //
    // The Wave 1b/1c/2 migrations name their primary keys explicitly
    // (`PK_automation_rules`), while their entities let TypeORM mint a hash
    // (`PK_378bed501eacc036895837121c2`) — so those eleven tables' PK NAMES
    // differ between the migration-built and `synchronize`-built schemas. It is
    // a real divergence and it is reported as a review finding, not silently
    // tolerated: it is carved out here rather than asserted because the fix
    // belongs to the ORM entities in `libs/core`, and asserting it would fail
    // this file for something it cannot fix — the same reasoning the
    // `order_records` docblock above gives.
    //
    // **The carve-out is name-only, and deliberately narrow.** The PK's
    // uniqueness, its columns and their order are still compared (the
    // normalisation rewrites only the identifier, keeping `USING btree (id)`),
    // so a PK moving to a different column still fails here. Every non-PK index
    // — including the partial predicates — is compared untouched.
    const stripPkName = (rows: unknown[]): unknown[] =>
      (rows as { indexname: string; indexdef: string; tablename: string }[]).map((row) =>
        /^PK_/.test(row.indexname)
          ? {
              ...row,
              indexname: `PK_<generated>_${row.tablename}`,
              indexdef: row.indexdef.replace(/"PK_[^"]+"/, '"PK_<generated>"'),
            }
          : row
      );

    const [synchronized, fromMigration] = await bothSides(INDEXES_SQL);

    // ## A REAL divergence, pinned rather than carved out
    //
    // Two `returns` indexes are `"createdAt" DESC` in the migration and plain
    // ascending in the ORM entity, so the index production builds is not the one
    // every test exercises. It is a live finding of this review, owned by the
    // entity in `libs/core` — which is why it is pinned here instead of fixed
    // here.
    //
    // Pinned, not skipped: each entry asserts BOTH sides' exact definitions, so
    // the moment the entity is corrected this test fails and tells whoever fixed
    // it to delete the entry. A bare exclusion would let the drift outlive its
    // own remedy.
    const KNOWN_DIVERGENCES: Record<string, { migration: string; entity: string }> = {
      IDX_returns_orphan_reattribution: {
        migration:
          'CREATE INDEX "IDX_returns_orphan_reattribution" ON public.returns USING btree ("sourceConnectionId", "createdAt" DESC) WHERE (("internalOrderId" IS NULL) AND ("externalOrderId" IS NOT NULL))',
        entity:
          'CREATE INDEX "IDX_returns_orphan_reattribution" ON public.returns USING btree ("sourceConnectionId", "createdAt") WHERE (("internalOrderId" IS NULL) AND ("externalOrderId" IS NOT NULL))',
      },
      IDX_returns_orphans: {
        migration:
          'CREATE INDEX "IDX_returns_orphans" ON public.returns USING btree ("createdAt" DESC) WHERE ("internalOrderId" IS NULL)',
        entity:
          'CREATE INDEX "IDX_returns_orphans" ON public.returns USING btree ("createdAt") WHERE ("internalOrderId" IS NULL)',
      },
    };

    const defOf = (rows: unknown[], name: string): string | undefined =>
      (rows as { indexname: string; indexdef: string }[]).find((row) => row.indexname === name)
        ?.indexdef;

    for (const [name, expected] of Object.entries(KNOWN_DIVERGENCES)) {
      expect(defOf(fromMigration, name)).toBe(expected.migration);
      expect(defOf(synchronized, name)).toBe(expected.entity);
    }

    const withoutKnown = (rows: unknown[]): unknown[] =>
      (rows as { indexname: string }[]).filter((row) => !(row.indexname in KNOWN_DIVERGENCES));

    expect(stripPkName(withoutKnown(fromMigration))).toEqual(
      stripPkName(withoutKnown(synchronized))
    );
    expect(fromMigration.length).toBeGreaterThan(0);

    // Non-vacuity for the carve-out itself: if the normalisation ever matched
    // every row, the comparison above would be meaningless.
    expect(
      (fromMigration as { indexname: string }[]).filter((row) => !/^PK_/.test(row.indexname)).length
    ).toBeGreaterThan(0);
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
    // Non-vacuity, expressed as a CONTAINMENT rather than an exhaustive roster.
    // The roster was the same trap the `TABLES`-derived assertion above names:
    // adding a table failed here first, for a reason unrelated to the schema
    // being checked. Naming the two the file's own prose reasons about keeps the
    // guard real without making every new @Check a two-place edit.
    const checkNames = checksOf(fromMigration).map((entry) => entry.split(' ')[0]);
    expect(checkNames).toEqual(expect.arrayContaining([
      'CHK_fulfillment_holds_actor',
      'CHK_fulfillment_work_lines_capacity',
    ]));

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
    // Containment, not an exhaustive roster — the same trap the `TABLES`-derived
    // assertion above names. The four fulfilment FKs are the ones this file's
    // CASCADE test exercises and are asserted by name; the wave 1b/1c tables add
    // their own, and every FK found is checked for CASCADE below regardless.
    expect(foreignKeys.map((r) => r.conname).sort()).toEqual(expect.arrayContaining([
      'FK_fulfillment_holds_work',
      'FK_fulfillment_progress_claims_work',
      'FK_fulfillment_work_lines_work',
      'FK_fulfillment_work_rejections_work',
    ]));
    // Each FK's DELETE RULE asserted individually, because they are not one
    // rule: the fulfilment children CASCADE with their parent work, a return's
    // lines CASCADE with the return, a location's owning connection is nulled
    // rather than taking the location with it, and a position carrying live
    // reservations must not vanish at all. Asserting "CASCADE everywhere" over a
    // derived list would have been a check that quietly weakened as the list grew.
    const EXPECTED_DELETE_RULE: Record<string, string> = {
      FK_fulfillment_holds_work: 'ON DELETE CASCADE',
      FK_fulfillment_progress_claims_work: 'ON DELETE CASCADE',
      FK_fulfillment_work_lines_work: 'ON DELETE CASCADE',
      FK_fulfillment_work_rejections_work: 'ON DELETE CASCADE',
      FK_return_lines_return: 'ON DELETE CASCADE',
      FK_inventory_locations_owner_connection: 'ON DELETE SET NULL',
      FK_reservations_inventory_item: 'ON DELETE RESTRICT',
    };
    for (const fk of foreignKeys) {
      const rule = EXPECTED_DELETE_RULE[fk.conname];
      // An unlisted FK fails rather than passing silently: a new one arriving
      // with no declared delete rule is exactly what this file exists to notice.
      expect({ fk: fk.conname, declared: rule !== undefined }).toEqual({
        fk: fk.conname,
        declared: true,
      });
      expect(fk.definition).toContain(rule);
    }
    // The stated asymmetry, asserted so it cannot silently stop being true —
    // narrowed to the FULFILMENT foreign keys, which is what the claim was ever
    // about. Extending `TABLES` showed the blanket form was too strong: the
    // reservations entity DOES declare its `inventory_items` relation, so
    // `synchronize` builds that one FK. Blanket-asserting an empty set would
    // have forced deleting a real entity relation to keep a test green.
    const syncForeignKeys = synchronized.filter((r) => r.contype === 'f');
    for (const name of [
      'FK_fulfillment_holds_work',
      'FK_fulfillment_progress_claims_work',
      'FK_fulfillment_work_lines_work',
      'FK_fulfillment_work_rejections_work',
    ]) {
      expect(syncForeignKeys.map((r) => r.conname)).not.toContain(name);
    }

    // Where BOTH schemas declare an FK it must be the SAME FK — a stronger
    // statement than the emptiness assertion it replaces, and the one that
    // matters now that the entity side is no longer empty.
    const migrationByName = new Map(foreignKeys.map((r) => [r.conname, r.definition]));
    for (const fk of syncForeignKeys) {
      expect({ fk: fk.conname, definition: migrationByName.get(fk.conname) }).toEqual({
        fk: fk.conname,
        definition: fk.definition,
      });
    }
  });

  it('should delete lines, holds, rejections and progress claims when their parent work is deleted', async () => {
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
    await migrated.query(
      `INSERT INTO "fulfillment_work_rejections"
         ("fulfillmentWorkId","orderId","connectionId","assignmentAttempt","reason","blocking","rejectedAt")
       VALUES ('w-parity','ol_order_parity','11111111-1111-1111-1111-111111111111',1,'no-stock',true,now())`
    );
    // #2400's claim table is a child too, and its CASCADE matters for a reason
    // the others' does not: an orphaned claim would let a re-created work id
    // inherit a stale suppression and silently discard its first real event.
    await migrated.query(
      `INSERT INTO "fulfillment_progress_claims"("workId","idempotencyKey","connectionId","eventKind","claimedAt")
       VALUES ('w-parity','vendor-key-1','11111111-1111-1111-1111-111111111111','shipped',now())`
    );

    const countChildren = async (): Promise<number> => {
      const [{ total }] = (await migrated.query(
        `SELECT (
           (SELECT count(*) FROM "fulfillment_work_lines" WHERE "fulfillmentWorkId" = 'w-parity') +
           (SELECT count(*) FROM "fulfillment_holds" WHERE "fulfillmentWorkId" = 'w-parity') +
           (SELECT count(*) FROM "fulfillment_work_rejections" WHERE "fulfillmentWorkId" = 'w-parity') +
           (SELECT count(*) FROM "fulfillment_progress_claims" WHERE "workId" = 'w-parity')
         )::int AS total`
      )) as { total: number }[];
      return total;
    };

    expect(await countChildren()).toBe(4);
    await migrated.query(`DELETE FROM "fulfillment_works" WHERE "id" = 'w-parity'`);
    expect(await countChildren()).toBe(0);
  });

  /**
   * `shipments.fulfillmentWorkId` (#2402) — a TARGETED assertion, deliberately
   * not an entry in `TABLES`.
   *
   * `shipments` is not a table this slice creates: **13 migrations** touch it,
   * and `1862000000000-add-shipment-direction` adds a column default and drops
   * it in the same statement — exactly the shape that diverges between a
   * migration-built and a `synchronize`-built schema. Adding it to `TABLES`
   * would therefore diff pre-existing legacy drift that this issue neither
   * caused nor can fix, which is what this file's own header disclaims
   * ("a whole-schema diff would fail on pre-existing drift").
   *
   * So the honest instrument is to assert the two objects #2402 actually adds,
   * on BOTH databases. Do not "complete" the `TABLES` list with `'shipments'`
   * — that reopens the drift this scoping avoids.
   */
  describe('shipments.fulfillmentWorkId (#2402)', () => {
    const COLUMN_SQL = `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'shipments'
        AND column_name = 'fulfillmentWorkId'
    `;

    const INDEX_SQL = `
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'shipments'
        AND indexname = 'IDX_shipments_fulfillmentWorkId'
    `;

    it('should declare the same column in the migration and the entity', async () => {
      const [fromEntity, fromMigration] = (await Promise.all([
        harness.getDataSource().query(COLUMN_SQL),
        migrated.query(COLUMN_SQL),
      ])) as Record<string, unknown>[][];

      // Non-vacuity first: an empty pair would otherwise "match" and pass.
      expect(fromMigration).toHaveLength(1);
      expect(fromEntity).toEqual(fromMigration);

      // Nullable with NO default: `NULL` is the ordinary state (pre-OMS and
      // unrouted orders), and a default would silently link nothing to
      // something.
      expect(fromMigration[0]).toMatchObject({
        data_type: 'text',
        is_nullable: 'YES',
        column_default: null,
      });
    });

    it('should declare the same index in the migration and the entity', async () => {
      const [fromEntity, fromMigration] = (await Promise.all([
        harness.getDataSource().query(INDEX_SQL),
        migrated.query(INDEX_SQL),
      ])) as { indexname: string; indexdef: string }[][];

      expect(fromMigration).toHaveLength(1);
      expect(fromEntity).toEqual(fromMigration);

      // FULL, not partial — unlike the sibling reservation-consume index on
      // this same table. That set shrinks to nothing; this one grows to the
      // majority as OMS routing is adopted, and a partial predicate would also
      // refuse to serve the `IS NULL` scan the fill-in-when-NULL repair needs.
      expect(fromMigration[0].indexdef).not.toContain('WHERE');
    });
  });
});
