/**
 * Fulfillment Progress — dedup against a real database (#2400, AC2)
 *
 * **This must be an int-spec, not a unit spec.** The enforcement is the
 * composite PRIMARY KEY `(workId, idempotencyKey)`; a mocked query builder can
 * prove the repository CALLS `orIgnore()`, but only a real database can prove
 * there is a constraint for it to conflict against. An application
 * `SELECT`-then-`INSERT` would pass a mock-based test and enforce nothing at
 * READ COMMITTED, where the conflicting row is a phantom that cannot be locked
 * before it exists.
 *
 * RED-FIRST EVIDENCE: run first with the composite PK replaced by a
 * single-column PK on `workId` only — `should be a no-op on replay` still
 * passed (any second insert conflicts), but
 * `should NOT suppress a different key for the same work` failed with
 * `Expected: true, Received: false`, which is the assertion that distinguishes
 * a correct composite key from a too-narrow one. Both directions are therefore
 * load-bearing and both are kept.
 *
 * @module apps/api/test/integration
 */
import { FULFILLMENT_PROGRESS_CLAIM_REPOSITORY_TOKEN } from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * Resolved by TOKEN against a LOCAL structural type, never by importing the
 * repository class.
 *
 * `FulfillmentProgressClaimRepositoryPort` is deliberately not on the
 * `@openlinker/core/fulfillment` barrel — `check-cross-context-imports` denies
 * `*RepositoryPort` as an intra-context persistence contract — and the concrete
 * class lives behind a path the package `exports` map does not publish. This is
 * the `diagnostic-holds-are-inert.int-spec.ts` shape the barrel names for
 * exactly this situation.
 */
interface ProgressClaimRepositoryShape {
  claim(input: {
    workId: string;
    idempotencyKey: string;
    connectionId: string;
    eventKind: string;
    claimedAt: Date;
  }): Promise<boolean>;
}

describe('Fulfillment progress dedup (#2400)', () => {
  let harness: IntegrationTestHarness;
  let repository: ProgressClaimRepositoryShape;

  const WORK_ID = 'ol_work_dedup';

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<ProgressClaimRepositoryShape>(
      FULFILLMENT_PROGRESS_CLAIM_REPOSITORY_TOKEN
    );
  }, 180000);

  afterAll(async () => {
    await teardownTestHarness();
  });

  beforeEach(async () => {
    await resetTestHarness();
    // A real parent row: the FK is migration-only, but the work must exist for
    // the scenario to mean anything.
    await harness
      .getDataSource()
      .query(`INSERT INTO "fulfillment_works"("id","orderId") VALUES ($1,'ol_order_dedup')`, [
        WORK_ID,
      ]);
  });

  const claim = (idempotencyKey: string): Promise<boolean> =>
    repository.claim({
      workId: WORK_ID,
      idempotencyKey,
      connectionId: '11111111-1111-1111-1111-111111111111',
      eventKind: 'shipped',
      claimedAt: new Date(),
    });

  it('should let the first claim win and report a replay of the same key as lost', async () => {
    expect(await claim('vendor-key-1')).toBe(true);
    expect(await claim('vendor-key-1')).toBe(false);
    expect(await claim('vendor-key-1')).toBe(false);
  });

  it('should NOT suppress a different key for the same work', async () => {
    // The assertion that distinguishes a correct COMPOSITE key from a
    // too-narrow one on `workId` alone — a work object legitimately reports
    // many progress facts.
    expect(await claim('vendor-key-1')).toBe(true);
    expect(await claim('vendor-key-2')).toBe(true);
  });

  it('should let exactly ONE of N concurrent claims for the same key win', async () => {
    // Deterministic without a lock-step harness because the guarantee is the
    // database's: whichever transaction commits second conflicts. The
    // discriminating property is `1`, not `>= 1` — a `SELECT`-then-`INSERT`
    // implementation returns `true` from several of these under real
    // concurrency, which is exactly the defect being excluded.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claim('vendor-key-concurrent'))
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('should persist exactly one row per claimed key', async () => {
    await claim('vendor-key-1');
    await claim('vendor-key-1');

    const rows = (await harness
      .getDataSource()
      .query(`SELECT count(*)::int AS total FROM "fulfillment_progress_claims" WHERE "workId" = $1`, [
        WORK_ID,
      ])) as { total: number }[];

    expect(rows[0].total).toBe(1);
  });
});
