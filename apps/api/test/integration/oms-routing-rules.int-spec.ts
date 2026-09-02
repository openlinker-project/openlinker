/**
 * OMS Routing Rules Integration Test (#2408)
 *
 * Verifies the `oms_routing_rules` table and `OmsRoutingRuleRepository` against
 * real Postgres (Testcontainers). Three things here exist only in SQL and
 * therefore cannot be proven by a unit spec:
 *
 *  - the effective-dating window (`effectiveFrom <= now`, `effectiveTo > now`,
 *    each arm NULL-tolerant) — a boundary a mocked repository would simply
 *    assert back at itself;
 *  - the `(connectionId, kind, name) WHERE "effectiveTo" IS NULL` partial
 *    unique index, which is the duplicate detection ADR-054's storage amendment
 *    asks for, and which must NOT stop a superseded row coexisting with its
 *    replacement;
 *  - that the table exists in the harness's schema at all. It is built by
 *    `autoLoadEntities` + `synchronize` off `OmsModule.register()`'s
 *    `TypeOrmModule.forFeature`, not by the plugin migration — and `setup.ts`
 *    lists it in `tablesToTruncate`, whose probe is a real `SELECT` against it.
 *
 * The coercer's own narrowing is unit-tested (`routing-rule.types.spec.ts`);
 * what is asserted here is that a row this build cannot understand is dropped
 * on the way OUT of the database, which is the only place an unknown name can
 * actually arrive from.
 *
 * @module apps/api/test/integration
 */
import { ROUTING_RULE_SOURCE_TOKEN, type RoutingRuleSourcePort } from '@openlinker/oms';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

const CONNECTION_ID = 'conn-oms-routing';

describe('OMS Routing Rules Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  function getRepository(): RoutingRuleSourcePort {
    return harness.getApp().get<RoutingRuleSourcePort>(ROUTING_RULE_SOURCE_TOKEN);
  }

  async function insertRule(overrides: Record<string, unknown> = {}): Promise<void> {
    const row = {
      connectionId: CONNECTION_ID,
      position: 1,
      kind: 'filter',
      name: 'in-stock',
      afterAction: 'quantity-split',
      priorityLocationIds: [],
      effectiveFrom: null,
      effectiveTo: null,
      ...overrides,
    };

    await harness.getDataSource().query(
      `INSERT INTO "oms_routing_rules"
         ("connectionId", "position", "kind", "name", "afterAction",
          "priorityLocationIds", "effectiveFrom", "effectiveTo")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        row.connectionId,
        row.position,
        row.kind,
        row.name,
        row.afterAction,
        JSON.stringify(row.priorityLocationIds),
        row.effectiveFrom,
        row.effectiveTo,
      ]
    );
  }

  const now = new Date('2026-08-31T12:00:00.000Z');

  it('should read back an undated rule, narrowed into the closed vocabulary', async () => {
    await insertRule({ position: 2, kind: 'sort', name: 'priority', priorityLocationIds: ['loc-b', 'loc-a'] });

    const rules = await getRepository().listActiveRules(CONNECTION_ID, now);

    expect(rules).toEqual([
      expect.objectContaining({
        position: 2,
        kind: 'sort',
        name: 'priority',
        afterAction: 'quantity-split',
        priorityLocationIds: ['loc-b', 'loc-a'],
      }),
    ]);
  });

  it('should return rules in position order, not insertion order', async () => {
    await insertRule({ position: 9, kind: 'sort', name: 'nearest' });
    await insertRule({ position: 1, kind: 'filter', name: 'in-stock' });

    const rules = await getRepository().listActiveRules(CONNECTION_ID, now);
    expect(rules.map((rule) => rule.name)).toEqual(['in-stock', 'nearest']);
  });

  it('should not return a rule whose window has not opened or has closed', async () => {
    await insertRule({ name: 'in-stock', effectiveFrom: new Date('2026-09-01T00:00:00.000Z') });
    await insertRule({ name: 'country-served', effectiveTo: new Date('2026-08-30T00:00:00.000Z') });

    await expect(getRepository().listActiveRules(CONNECTION_ID, now)).resolves.toEqual([]);
  });

  it('should return a rule whose window is open around `now`', async () => {
    await insertRule({
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      effectiveTo: new Date('2026-09-30T00:00:00.000Z'),
    });

    const rules = await getRepository().listActiveRules(CONNECTION_ID, now);
    expect(rules).toHaveLength(1);
  });

  it('should not return another connection’s ruleset', async () => {
    await insertRule({ connectionId: 'conn-other' });

    await expect(getRepository().listActiveRules(CONNECTION_ID, now)).resolves.toEqual([]);
  });

  it('should reject a second LIVE rule with the same (kind, name)', async () => {
    await insertRule();

    await expect(insertRule()).rejects.toThrow(/UQ_oms_routing_rules_live_name|duplicate key/);
  });

  it('should let a superseded rule coexist with its replacement', async () => {
    // The index is partial on `effectiveTo IS NULL` precisely so history is
    // keepable: closing a rule must not require deleting it.
    await insertRule({ effectiveTo: new Date('2026-08-30T00:00:00.000Z') });
    await expect(insertRule()).resolves.toBeUndefined();

    const rules = await getRepository().listActiveRules(CONNECTION_ID, now);
    expect(rules).toHaveLength(1);
  });

  it('should drop a persisted rule whose name this build does not understand', async () => {
    // The column outlives the build that wrote it. A `method-capable` row —
    // deliberately not declared here (#2736) — must be dropped, never guessed
    // at, and must not take the rest of the ruleset down with it.
    await insertRule({ name: 'method-capable' });
    await insertRule({ position: 2, kind: 'sort', name: 'nearest' });

    const rules = await getRepository().listActiveRules(CONNECTION_ID, now);
    expect(rules.map((rule) => rule.name)).toEqual(['nearest']);
  });
});
