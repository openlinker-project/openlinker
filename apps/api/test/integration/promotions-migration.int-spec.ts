/**
 * Promotions migration - data copy and reversal (#3935)
 *
 * `1939500000000-create-promotions.ts` moves gift rules out of the automation
 * tables. The integration harness builds its schema by `synchronize`, so nothing
 * else runs that migration, and a migration that moves live rows is exactly the
 * kind that must be run against data once.
 *
 * Builds the full migration chain in a second database, reverses OUR migration to
 * get the pre-move schema, seeds what a gift rule left behind (a rule, its state,
 * its grants and its runs, beside an unrelated automation), runs `up()` and
 * asserts ids were kept and the old homes emptied, then `down()` and asserts the
 * rows came back, then `up()` once more.
 *
 * @module apps/api/test/integration
 */
import { DataSource, type QueryRunner } from 'typeorm';

import { ensureMigrationPrerequisites } from '../../src/database/ensure-migration-prerequisites';
import { CreatePromotions1939500000000 } from '../../src/migrations/1939500000000-create-promotions';
import { PromotionCombinesWith1939700000000 } from '../../src/migrations/1939700000000-promotion-combines-with';
import type { IntegrationTestHarness} from './setup';
import { getTestHarness, teardownTestHarness } from './setup';

const RULE = '11111111-1111-4111-8111-111111111111';
const RULE_B = '22222222-2222-4222-8222-222222222222';
const PACKED_RULE = '33333333-3333-4333-8333-333333333333';
const RUN_DONE = '44444444-4444-4444-8444-444444444441';
const RUN_SKIPPED = '44444444-4444-4444-8444-444444444442';
const RUN_FAILED = '44444444-4444-4444-8444-444444444443';
const USER = '55555555-5555-4555-8555-555555555555';

const GIFT_ACTION = {
  action: 'add-gift',
  productId: 'p-gift',
  variantId: 'v-gift',
  quantity: 2,
  perUnit: { productId: 'p-book', per: 2, maxPerOrder: 3 },
  unitCap: 100,
  skipIfPresent: true,
  doNotCombine: true,
  customerLimit: 5,
  documentForm: 'technical-cent',
};

describe('Promotions migration', () => {
  let harness: IntegrationTestHarness;
  let migrated: DataSource;
  let runner: QueryRunner;
  const DB = 'promotions_migration';
  const migration = new CreatePromotions1939500000000();
  const combinesWithMigration = new PromotionCombinesWith1939700000000();

  const q = <T = Array<Record<string, unknown>>>(sql: string, params: unknown[] = []): Promise<T> =>
    runner.query(sql, params) as Promise<T>;

  beforeAll(async () => {
    harness = await getTestHarness();
    const options = harness.getDataSource().options as {
      host: string;
      port: number;
      username: string;
      password: string;
    };
    await harness.getDataSource().query(`DROP DATABASE IF EXISTS "${DB}"`);
    await harness.getDataSource().query(`CREATE DATABASE "${DB}"`);
    migrated = new DataSource({
      type: 'postgres',
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      database: DB,
      synchronize: false,
      migrationsRun: false,
      entities: [],
      migrations: [`${__dirname}/../../src/migrations/*.ts`],
    });
    await migrated.initialize();
    await ensureMigrationPrerequisites(migrated);
    await migrated.runMigrations();
    runner = migrated.createQueryRunner();
    await runner.connect();
    // Back to the pre-move schema (the later `combinesWith` migration first), then
    // leave what a gift rule leaves behind.
    await combinesWithMigration.down(runner);
    await migration.down(runner);
    await seed();
  }, 240000);

  afterAll(async () => {
    if (runner) await runner.release();
    if (migrated?.isInitialized) await migrated.destroy();
    await harness.getDataSource().query(`DROP DATABASE IF EXISTS "${DB}"`);
    await teardownTestHarness();
  });

  async function seed(): Promise<void> {
    const cond = JSON.stringify([{ field: 'containsProduct', op: 'eq', value: 'p-book' }]);
    await q(
      `INSERT INTO "automation_rules"
        ("id","name","trigger","triggerConfig","conditions","actions","definitionHash","isActive",
         "effectiveFrom","effectiveTo","position","createdAt","updatedAt")
       VALUES
        ($1,'Second','order.ingested','{}',$2::jsonb,$3::jsonb,'h1',true,'2026-11-01',NULL,2,now(),now()),
        ($4,'First','order.ingested','{}',$2::jsonb,$5::jsonb,'h2',false,'2026-11-01','2026-12-31',1,now(),now()),
        ($6,'Mail','order.packed','{}','[]'::jsonb,'[{"action":"relay-status-to-source"}]'::jsonb,'h3',true,'2026-11-01',NULL,NULL,now(),now())`,
      [
        RULE,
        cond,
        JSON.stringify([GIFT_ACTION]),
        RULE_B,
        JSON.stringify([{ ...GIFT_ACTION, perUnit: null, unitCap: null, customerLimit: null, doNotCombine: false }]),
        PACKED_RULE,
      ]
    );
    await q(
      `INSERT INTO "automation_gift_rule_state" ("ruleId","pausedReason","pausedAt","capExtension")
       VALUES ($1,'unit-cap',now(),25)`,
      [RULE]
    );
    await q(
      `INSERT INTO "automation_gift_grants"
        ("ruleId","internalOrderId","customerId","quantity","productId","variantId","documentForm")
       VALUES ($1,'o1','c1',2,'p-gift','v-gift','technical-cent'), ($1,'o2',NULL,4,'p-gift','v-gift',NULL)`,
      [RULE]
    );
    const step = (status: string, detail: string, reasonCode?: string): string =>
      JSON.stringify([
        { stepIndex: 0, action: 'add-gift', status, detail, ...(reasonCode && { reasonCode }) },
      ]);
    await q(
      `INSERT INTO "automation_runs"
        ("id","ruleId","ruleName","trigger","subjectKind","subjectId","outcome","steps","firedAt","dismissedAt","dismissedByUserId")
       VALUES
        ($1,$4,'Second','order.ingested','order','o1','done',$5::jsonb,now(),NULL,NULL),
        ($2,$4,'Second','order.ingested','order','o3','nothing-to-do',$6::jsonb,now(),now(),$8),
        ($3,$4,'Second','order.ingested','order','o4','failed',$7::jsonb,now(),NULL,NULL),
        (gen_random_uuid(),$9,'Mail','order.packed','order','o1','done','[]'::jsonb,now(),NULL,NULL)`,
      [
        RUN_DONE,
        RUN_SKIPPED,
        RUN_FAILED,
        RULE,
        step('done', 'Added 2 gift unit(s) to the order.'),
        step('nothing-to-do', 'No gift added: gift-out-of-stock.', 'gift-out-of-stock'),
        step('failed', 'Gift not added to order o4: db down'),
        USER,
        PACKED_RULE,
      ]
    );
  }

  const count = async (table: string): Promise<number> =>
    Number((await q<Array<{ n: string }>>(`SELECT count(*)::text AS n FROM "${table}"`))[0].n);

  it('should copy definitions with ids kept, dense positions, and a mapped benefit', async () => {
    await migration.up(runner);

    const rows = await q<
      Array<{
        id: string;
        name: string;
        position: number;
        combinable: boolean;
        unitCap: number | null;
        customerLimit: number | null;
        benefit: Record<string, unknown>;
        isActive: boolean;
      }>
    >(`SELECT "id","name","position","combinable","unitCap","customerLimit","benefit","isActive"
         FROM "promotions" ORDER BY "position"`);

    expect(rows.map((r) => [r.id, r.position])).toEqual([
      [RULE_B, 1],
      [RULE, 2],
    ]);
    expect(rows[1]).toMatchObject({ name: 'Second', combinable: false, unitCap: 100, customerLimit: 5 });
    expect(rows[1].benefit).toEqual({
      kind: 'free-gift',
      productId: 'p-gift',
      variantId: 'v-gift',
      quantity: 2,
      perUnit: { productId: 'p-book', per: 2, maxPerOrder: 3 },
      skipIfPresent: true,
      documentForm: 'technical-cent',
    });
    expect(rows[0]).toMatchObject({ combinable: true, unitCap: null, isActive: false });
    expect(rows[0].benefit.perUnit).toBeNull();
  });

  it('should copy state and grants with the same ids and the application log from the runs', async () => {
    expect(await q(`SELECT "promotionId","pausedReason","capExtension" FROM "promotion_state"`)).toEqual([
      { promotionId: RULE, pausedReason: 'unit-cap', capExtension: 25 },
    ]);
    expect(await count('promotion_grants')).toBe(2);

    const log = await q<
      Array<{ id: string; outcome: string; reason: string | null; quantity: number; dismissed: boolean }>
    >(`SELECT "id","outcome","reason","quantity","dismissedAt" IS NOT NULL AS dismissed
         FROM "promotion_applications" ORDER BY "id"`);
    expect(log).toEqual([
      { id: RUN_DONE, outcome: 'applied', reason: null, quantity: 2, dismissed: false },
      { id: RUN_SKIPPED, outcome: 'skipped', reason: 'gift-out-of-stock', quantity: 0, dismissed: true },
      { id: RUN_FAILED, outcome: 'failed', reason: null, quantity: 0, dismissed: false },
    ]);
  });

  it('should remove the gift rows from automation and leave other automations alone', async () => {
    expect(await q(`SELECT "id" FROM "automation_rules" WHERE "trigger" = 'order.ingested'`)).toEqual([]);
    expect(await q(`SELECT "id" FROM "automation_rules" WHERE "id" = $1`, [PACKED_RULE])).toHaveLength(1);
    expect(await q(`SELECT 1 FROM "automation_runs" WHERE "trigger" = 'order.ingested'`)).toEqual([]);
    expect(await q(`SELECT 1 FROM "automation_runs" WHERE "ruleId" = $1`, [PACKED_RULE])).toHaveLength(1);
    const gone = await q(
      `SELECT to_regclass('automation_gift_grants') AS a, to_regclass('automation_gift_rule_state') AS b`
    );
    expect(gone).toEqual([{ a: null, b: null }]);
    const column = await q(
      `SELECT 1 FROM information_schema.columns WHERE table_name='automation_rules' AND column_name='position'`
    );
    expect(column).toHaveLength(0);
  });

  it('should reverse completely: rules, state, grants and runs come back under the same ids', async () => {
    await migration.down(runner);

    const rules = await q<
      Array<{ id: string; position: number | null; actions: Array<Record<string, unknown>>; isActive: boolean }>
    >(`SELECT "id","position","actions","isActive" FROM "automation_rules"
        WHERE "trigger"='order.ingested' ORDER BY "position"`);
    expect(rules.map((r) => [r.id, r.position])).toEqual([
      [RULE_B, 1],
      [RULE, 2],
    ]);
    expect(rules[1].actions[0]).toEqual(GIFT_ACTION);
    expect(await count('automation_gift_grants')).toBe(2);
    expect(
      await q(`SELECT "ruleId","pausedReason","capExtension" FROM "automation_gift_rule_state"`)
    ).toEqual([{ ruleId: RULE, pausedReason: 'unit-cap', capExtension: 25 }]);

    const runs = await q<Array<{ id: string; outcome: string }>>(
      `SELECT "id","outcome" FROM "automation_runs" WHERE "trigger"='order.ingested' ORDER BY "id"`
    );
    expect(runs).toEqual([
      { id: RUN_DONE, outcome: 'done' },
      { id: RUN_SKIPPED, outcome: 'nothing-to-do' },
      { id: RUN_FAILED, outcome: 'failed' },
    ]);
    expect(await q(`SELECT to_regclass('promotions') AS t`)).toEqual([{ t: null }]);
  });

  it('should migrate again after a reversal (the round trip is repeatable)', async () => {
    await migration.up(runner);

    expect(await count('promotions')).toBe(2);
    expect(await count('promotion_grants')).toBe(2);
  });

  describe('combinable -> combinesWith', () => {
    const hashes = async (): Promise<Map<string, string>> =>
      new Map(
        (await q<Array<{ id: string; definitionHash: string }>>(`SELECT "id","definitionHash" FROM "promotions"`)).map(
          (r) => [r.id, r.definitionHash]
        )
      );

    it('should map true to all and false to none and recompute the hashes', async () => {
      const before = await hashes();
      await combinesWithMigration.up(runner);

      const rows = await q<Array<{ id: string; combinesWith: unknown }>>(
        `SELECT "id","combinesWith" FROM "promotions"`
      );
      expect(Object.fromEntries(rows.map((r) => [r.id, r.combinesWith]))).toEqual({
        [RULE_B]: { mode: 'all' },
        [RULE]: { mode: 'none' },
      });
      const after = await hashes();
      expect(after.get(RULE)).not.toBe(before.get(RULE));
      expect(after.get(RULE_B)).not.toBe(before.get(RULE_B));
      expect(
        await q(`SELECT 1 FROM information_schema.columns WHERE table_name='promotions' AND column_name='combinable'`)
      ).toHaveLength(0);
    });

    it('should reverse lossily: selected reads as not combinable', async () => {
      await q(`UPDATE "promotions" SET "combinesWith" = $1::jsonb WHERE "id" = $2`, [
        JSON.stringify({ mode: 'selected', promotionIds: [RULE] }),
        RULE_B,
      ]);
      await combinesWithMigration.down(runner);

      const rows = await q<Array<{ id: string; combinable: boolean }>>(
        `SELECT "id","combinable" FROM "promotions"`
      );
      expect(Object.fromEntries(rows.map((r) => [r.id, r.combinable]))).toEqual({
        [RULE_B]: false,
        [RULE]: false,
      });
      expect(
        await q(`SELECT 1 FROM information_schema.columns WHERE table_name='promotions' AND column_name='combinesWith'`)
      ).toHaveLength(0);
    });

    it('should migrate again after the reversal', async () => {
      await combinesWithMigration.up(runner);

      const rows = await q<Array<{ combinesWith: { mode: string } }>>(`SELECT "combinesWith" FROM "promotions"`);
      expect(rows.map((r) => r.combinesWith.mode)).toEqual(['none', 'none']);
    });
  });
});
