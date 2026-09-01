/**
 * AF-X attention derivation, dismissal and retry refusals (#2387)
 *
 * These properties are SQL, not TypeScript: the attention predicate is a
 * correlated `NOT EXISTS` shared by the filter and the count, and dismissal is a
 * conditional UPDATE. A unit test over a mocked repository cannot observe either
 * — it would assert that the code calls the method it calls.
 *
 * The one that most needs a real database is **count-agrees-with-rows**: those
 * are two different SQL shapes over one predicate, and a count whose rows do not
 * match it is the divergence class that puts "4 need attention" above an empty
 * table.
 *
 * @module apps/api/test/integration/automation
 */
import {
  AUTOMATION_MAX_RETRY_ATTEMPTS,
  AUTOMATION_RUNS_READ_SERVICE_TOKEN,
} from '@openlinker/core/automation';
import type { IAutomationRunsReadService } from '@openlinker/core/automation';

import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';

describe('Automation attention state (#2387)', () => {
  let harness: IntegrationTestHarness;
  let token: string;
  // The READ service, never `AutomationRunRepositoryPort` — a repository port is
  // an intra-context contract and `apps/api` is a scope
  // `check-cross-context-imports.mjs` walks, where `*RepositoryPort` is a deny
  // shape. Rows are seeded with raw SQL below, which is also the honest tool
  // here: every property under test IS SQL.
  let runs: IAutomationRunsReadService;

  const firedAt = new Date('2026-08-20T10:00:00.000Z');

  interface SeedOptions {
    outcome?: string;
    subjectId?: string;
    subjectKind?: string;
    retryOfRunId?: string | null;
    retryAttempt?: number;
    ruleId?: string;
  }

  /** Seed one `automation_runs` row and return its id. */
  async function seedRun(options: SeedOptions = {}): Promise<string> {
    const rows: Array<{ id: string }> = await harness.getDataSource().query(
      `INSERT INTO "automation_runs"
         ("ruleId", "ruleName", "trigger", "subjectKind", "subjectId", "outcome",
          "steps", "blockedByRuleIds", "firedAt", "retryOfRunId", "retryAttempt")
       VALUES ($1, $2, $3, $4, $5, $6, '[]'::jsonb, NULL, $7, $8, $9)
       RETURNING "id"`,
      [
        options.ruleId ?? '11111111-1111-1111-1111-111111111111',
        'Ship paid orders',
        'order.packed',
        options.subjectKind ?? 'order',
        options.subjectId ?? 'ol_order_1',
        options.outcome ?? 'failed',
        firedAt,
        options.retryOfRunId ?? null,
        options.retryAttempt ?? 0,
      ],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Seeding an automation run returned no id.');
    return id;
  }

  /**
   * A REAL rule row, so a retry gets past `rule-deleted` (#2666).
   *
   * `resolveRetryEligibility` checks `rule-deleted` BEFORE the two chain
   * reasons, so the default seed's dangling rule id would mask both — the
   * endpoint would answer `rule-deleted` and the test would pass while
   * asserting nothing about the chain.
   */
  async function seedRule(): Promise<string> {
    const rows: Array<{ id: string }> = await harness.getDataSource().query(
      `INSERT INTO "automation_rules"
         ("name", "trigger", "triggerConfig", "conditions", "actions",
          "definitionHash", "isActive", "effectiveFrom")
       VALUES ('Ship paid orders', 'order.packed', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
               $1, true, '2026-01-01')
       RETURNING "id"`,
      [`hash-${Math.random().toString(16).slice(2)}`],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('Seeding an automation rule returned no id.');
    return id;
  }

  /** Read one seeded row's persisted dismissal columns. */
  async function readDismissal(
    id: string,
  ): Promise<{ dismissedAt: Date | null; dismissedByUserId: string | null; outcome: string }> {
    const rows: Array<{ dismissedAt: Date | null; dismissedByUserId: string | null; outcome: string }> =
      await harness
        .getDataSource()
        .query(`SELECT "dismissedAt", "dismissedByUserId", "outcome" FROM "automation_runs" WHERE "id" = $1`, [id]);
    const row = rows[0];
    if (row === undefined) throw new Error(`No automation run ${id}.`);
    return row;
  }

  beforeAll(async () => {
    harness = await getTestHarness();
    token = await loginAsAdmin(harness.getHttp(), harness.getDataSource());
    runs = harness.getApp().get<IAutomationRunsReadService>(AUTOMATION_RUNS_READ_SERVICE_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('should count a failed firing as needing attention', async () => {
    await seedRun();
    expect(await runs.countAttention()).toBe(1);
  });

  it.each(['done', 'nothing-to-do', 'blocked'] as const)(
    'should not count a %s firing',
    async (outcome) => {
      await seedRun({ outcome });
      expect(await runs.countAttention()).toBe(0);
    },
  );

  it('should stop counting a firing once it is dismissed', async () => {
    const runId = await seedRun();
    await runs.dismiss(runId, '22222222-2222-2222-2222-222222222222', new Date());
    expect(await runs.countAttention()).toBe(0);
  });

  it('should keep the run FAILED after dismissal — only the attention clears', async () => {
    const runId = await seedRun();
    await runs.dismiss(runId, '22222222-2222-2222-2222-222222222222', new Date());
    const row = await readDismissal(runId);
    // OpenLinker must not claim it did something a person did outside it.
    expect(row.outcome).toBe('failed');
    expect(row.dismissedAt).not.toBeNull();
  });

  it('should record only the FIRST dismisser', async () => {
    const runId = await seedRun();
    const first = new Date('2026-08-21T08:00:00.000Z');
    await runs.dismiss(runId, '22222222-2222-2222-2222-222222222222', first);
    await runs.dismiss(runId, '33333333-3333-3333-3333-333333333333', new Date());
    const row = await readDismissal(runId);
    // The conditional UPDATE is the serialization point — a concurrent second
    // dismisser changes nothing rather than overwriting the attribution.
    expect(row.dismissedByUserId).toBe('22222222-2222-2222-2222-222222222222');
    expect(row.dismissedAt?.toISOString()).toBe(first.toISOString());
  });

  it('should return null when dismissing a run that does not exist', async () => {
    expect(await runs.dismiss('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', new Date())).toBeNull();
  });

  it('should stop counting once a retry of THAT firing succeeds', async () => {
    const failedId = await seedRun();
    expect(await runs.countAttention()).toBe(1);

    await seedRun({ outcome: 'done', retryOfRunId: failedId });
    // The whole reason `retryOfRunId` is a column: a derived state is only
    // self-clearing if the derivation can SEE the thing that clears it.
    expect(await runs.countAttention()).toBe(0);
  });

  it('should count ONE row when a retry of that firing also failed', async () => {
    const failedId = await seedRun();
    await seedRun({ outcome: 'failed', retryOfRunId: failedId, retryAttempt: 1 });
    // Was 2 before #2666, which IS the defect: one underlying failure, two red
    // rows. A chain has one live end, and the newest link is the handle.
    expect(await runs.countAttention()).toBe(1);
  });

  it('should report ONE attention row for a three-deep failed chain, and all three surfaces must name it (#2666)', async () => {
    // THE load-bearing test. Three independently-red assertions, each against a
    // DIFFERENT surface resolving the shared predicate:
    //   1. countAttention()            — the badge  (returned 4 before)
    //   2. listRecent({attentionOnly}) — the filter (returned 4 rows before)
    //   3. the projected needsAttention — the row   (was true on all 4 before)
    // Assertion 4 (count === rows.length) is deliberately NOT the proof: those
    // two shapes agreed before this change too, so alone it is a check that
    // cannot fail. What proves they agree on the RIGHT SET is 1+2+3 together.
    const r0 = await seedRun();
    const r1 = await seedRun({ outcome: 'failed', retryOfRunId: r0, retryAttempt: 1 });
    const r2 = await seedRun({ outcome: 'failed', retryOfRunId: r1, retryAttempt: 2 });
    const r3 = await seedRun({ outcome: 'failed', retryOfRunId: r2, retryAttempt: 3 });

    const count = await runs.countAttention();
    const attentionRows = (await runs.listRecent({ attentionOnly: true }, 50, 0)).runs;
    const allRows = (await runs.listRecent({}, 50, 0)).runs;

    expect(count).toBe(1);
    expect(attentionRows.map((row) => row.id)).toEqual([r3]);

    const needsAttentionById = new Map(allRows.map((row) => [row.id, row.needsAttention]));
    expect(needsAttentionById.get(r3)).toBe(true);
    expect(needsAttentionById.get(r0)).toBe(false);
    expect(needsAttentionById.get(r1)).toBe(false);
    expect(needsAttentionById.get(r2)).toBe(false);

    expect(count).toBe(attentionRows.length);
  });

  it('should let a successful retry still clear a whole chain (#2387 regression)', async () => {
    const r0 = await seedRun();
    const r1 = await seedRun({ outcome: 'failed', retryOfRunId: r0, retryAttempt: 1 });
    await seedRun({ outcome: 'done', retryOfRunId: r1, retryAttempt: 2 });
    // A `done` retry is also "a retry that exists", and the successful head is
    // not itself attention-worthy — so #2387's behaviour is preserved, not
    // traded away for the chain-head rule.
    expect(await runs.countAttention()).toBe(0);
  });

  it('should refuse a retry of an already-superseded run over HTTP (#2666)', async () => {
    // The FORK guard, exercised through the ENDPOINT rather than the projection:
    // the frontend hides the control on a superseded row, and relying on that is
    // exactly what `resolveRetryEligibility`'s own contract forbids.
    const ruleId = await seedRule();
    const r0 = await seedRun({ ruleId });
    await seedRun({ ruleId, outcome: 'failed', retryOfRunId: r0, retryAttempt: 1 });

    const response = await harness
      .getHttp()
      .post(`/v1/automations/runs/${r0}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(response.body.reason).toBe('superseded');
  });

  it('should refuse a retry once the chain has spent its budget (#2666)', async () => {
    const ruleId = await seedRule();
    const exhausted = await seedRun({ ruleId, retryAttempt: AUTOMATION_MAX_RETRY_ATTEMPTS });

    const response = await harness
      .getHttp()
      .post(`/v1/automations/runs/${exhausted}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(response.body.reason).toBe('retry-exhausted');

    // The projection reports the IDENTICAL refusal — one rule, two enforcement
    // points, so the disabled control and the endpoint cannot drift.
    const projected = await runs.getRunById(exhausted);
    expect(projected?.retry).toEqual({ retryable: false, reason: 'retry-exhausted' });
  });

  it('should still allow a retry that has budget left and no newer attempt', async () => {
    // The positive control: without it, every refusal assertion above would
    // pass against an implementation that refuses everything.
    const ruleId = await seedRule();
    const runId = await seedRun({ ruleId, retryAttempt: AUTOMATION_MAX_RETRY_ATTEMPTS - 1 });
    const projected = await runs.getRunById(runId);
    expect(projected?.retry).toEqual({ retryable: true });
  });

  it('should keep counting when only an UNRELATED later firing of the same rule succeeded', async () => {
    await seedRun();
    await seedRun({ outcome: 'done' });
    // The spec forbids clearing on this, which is why latest-run-wins was
    // rejected in favour of the explicit link.
    expect(await runs.countAttention()).toBe(1);
  });

  it('should make the count agree with the rows the filter returns', async () => {
    const failedId = await seedRun();
    await seedRun({ outcome: 'done' });
    const dismissedId = await seedRun({ subjectId: 'ol_order_2' });
    await runs.dismiss(dismissedId, '22222222-2222-2222-2222-222222222222', new Date());

    const rows = (await runs.listRecent({ attentionOnly: true }, 50, 0)).runs;
    const count = await runs.countAttention();

    // Two SQL shapes, one predicate. A count whose rows do not match it is how
    // "4 need attention" appears above an empty table.
    expect(count).toBe(rows.length);
    expect(rows.map((row) => row.id)).toEqual([failedId]);
  });

  it('should treat attentionOnly as absent unless it is exactly "true"', async () => {
    await seedRun({ outcome: 'done' });
    const response = await harness
      .getHttp()
      .get('/v1/automations/runs?attentionOnly=false')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // An unrecognised narrowing value must WIDEN the result, never empty it.
    expect(response.body.runs).toHaveLength(1);
  });

  it('should project needsAttention and the retry verdict onto the run', async () => {
    await seedRun();
    const response = await harness
      .getHttp()
      .get('/v1/automations/runs')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [run] = response.body.runs;
    expect(run.needsAttention).toBe(true);
    // The rule id above belongs to no rule, so the retry is refused — and the
    // refusal is projected so the client can disable the control WITH a reason
    // rather than discovering the 400.
    expect(run.retryable).toBe(false);
    expect(run.retryRefusalReason).toBe('rule-deleted');
  });

  it('should report the attention count over HTTP', async () => {
    await seedRun();
    const response = await harness
      .getHttp()
      .get('/v1/automations/attention-count')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.count).toBe(1);
  });

  it('should refuse a retry the projection already said was refused', async () => {
    const runId = await seedRun();
    // Same rule as the projection test: the rule does not exist.
    const response = await harness
      .getHttp()
      .post(`/v1/automations/runs/${runId}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    // The endpoint enforces INDEPENDENTLY. If only the UI knew, a direct call
    // would bypass it.
    expect(response.body.reason).toBe('rule-deleted');
  });

  it('should dismiss over HTTP and clear the attention state', async () => {
    const runId = await seedRun();
    const response = await harness
      .getHttp()
      .post(`/v1/automations/runs/${runId}/dismiss`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.outcome).toBe('failed');
    expect(response.body.needsAttention).toBe(false);
    expect(await runs.countAttention()).toBe(0);
  });
});
