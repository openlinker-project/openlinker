/**
 * No migration seeds an OMS connection row (#2405 AC-2, ADR-055).
 *
 * ## Why this runs the real migration chain instead of using the harness
 *
 * ADR-055 calls "created on enable, never seeded" the single highest-risk
 * mechanical detail in the OMS design and its zero-config non-negotiable: a
 * migration-seeded `openlinker` connection would enter every existing
 * install's authority candidate sets and flip previously-single-candidate
 * selections to `ambiguous`, silently stopping working behaviour on upgrade.
 *
 * The obvious test — boot the harness, assert zero rows — **cannot fail**.
 * `libs/shared/src/database/database.module.ts` sets
 * `synchronize: NODE_ENV !== 'production'` and `migrationsRun: false`, and
 * `docs/testing-guide.md` § Testcontainers Lifecycle says so outright: the
 * schema is built by `synchronize` and **no migration runs in that path**. A
 * harness-based assertion is therefore green whether or not a seeding
 * migration exists — it is a check that cannot fail, which is worse than no
 * check because it reads like coverage.
 *
 * So this builds the migration chain for real, in a second database on the
 * same Testcontainers Postgres, exactly as
 * `fulfillment-work-migration-parity.int-spec.ts` (#2392) does — still the
 * only other automated check of a migration anywhere in this repository.
 *
 * ## What a failure here means
 *
 * Someone added a migration that INSERTs a connection row. Fix the migration,
 * not this test: the OMS row is created by `ConnectionService.create` when an
 * operator enables it, and by nothing else.
 *
 * Note the assertion is deliberately about **seeding**, i.e. INSERTs. A future
 * migration that only UPDATEs existing connection rows (for instance #2409
 * retro-filling `enabledCapabilities` on already-created OMS rows) legitimately
 * passes this, because it seeds nothing.
 *
 * **Known dependency** (#2684, inherited from the #2392 sibling): the first
 * migration creates `identifier_mappings` with `DEFAULT uuid_generate_v4()`
 * but never issues `CREATE EXTENSION "uuid-ossp"`, so the chain cannot run
 * against a genuinely empty database. Creating it here satisfies the
 * precondition without pretending the gap is absent. **Removal condition**:
 * delete that line when #2684 lands.
 *
 * **Cost**: runs the FULL migration chain once, hence the 180 s `beforeAll`.
 *
 * @module apps/api/test/integration
 */
import { DataSource } from 'typeorm';

import { getTestHarness, IntegrationTestHarness, teardownTestHarness } from './setup';

const OMS_PLATFORM_TYPE = 'openlinker';

describe('OMS connection — never seeded by a migration', () => {
  let harness: IntegrationTestHarness;
  let migrated: DataSource;
  const MIGRATED_DB = 'oms_never_seeded';

  beforeAll(async () => {
    harness = await getTestHarness();

    const options = harness.getDataSource().options as {
      host: string;
      port: number;
      username: string;
      password: string;
    };

    // A separate DATABASE rather than a schema: migrations write unqualified
    // names, so they must land in their own `public`.
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

    // See the #2684 note in the file docblock. Remove when that lands.
    await migrated.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    await migrated.runMigrations();
  }, 180000);

  afterAll(async () => {
    if (migrated?.isInitialized) await migrated.destroy();
    await harness.getDataSource().query(`DROP DATABASE IF EXISTS "${MIGRATED_DB}"`);
    await teardownTestHarness();
  });

  it('should have built the connections table from the migration chain alone', async () => {
    // Non-vacuity for every assertion below. Without this, a chain that built
    // nothing would make "zero connection rows" trivially true and the whole
    // file would assert nothing at all.
    const rows = (await migrated.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('connections','identifier_mappings')
       ORDER BY table_name`
    )) as { table_name: string }[];

    expect(rows.map((r) => r.table_name)).toEqual(['connections', 'identifier_mappings']);
  });

  it('should leave an untouched install with ZERO connections of any kind', async () => {
    const [{ count }] = (await migrated.query(
      `SELECT count(*)::int AS count FROM "connections"`
    )) as { count: number }[];

    // Deliberately not scoped to platformType: no migration should seed ANY
    // connection, and scoping would hide a seed written under another name.
    expect(count).toBe(0);
  });

  it('should leave ZERO openlinker connections specifically', async () => {
    const [{ count }] = (await migrated.query(
      `SELECT count(*)::int AS count FROM "connections" WHERE "platformType" = $1`,
      [OMS_PLATFORM_TYPE]
    )) as { count: number }[];

    expect(count).toBe(0);
  });

  it('should leave ZERO openlinker identifier mappings', async () => {
    // Subsumed by the connections assertion on a fresh chain (no migration
    // seeds a mapping without a connection), kept as documentation of the
    // second surface an OMS row would touch.
    const [{ count }] = (await migrated.query(
      `SELECT count(*)::int AS count FROM "identifier_mappings" WHERE "platformType" = $1`,
      [OMS_PLATFORM_TYPE]
    )) as { count: number }[];

    expect(count).toBe(0);
  });
});
