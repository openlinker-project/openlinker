/**
 * The dispatch-relay reconcile frontier (#2728) — integration
 *
 * Drives the real service against real Postgres. Four things only a database can
 * settle, and two of them are the issue's own acceptance criteria.
 *
 * **AC2 is asserted on the ROW, which is the only place it is durable.** The unit
 * guard (`no-progress-claim-release.spec.ts`) proves nothing in the context CAN
 * release a progress claim; this proves that after a real run against real rows the
 * claim is still there, so a replayed vendor event is still a no-op. A test that
 * asserted a fixture instead would be asserting the fixture.
 *
 * **The frontier is frontier-as-query**, so a work that acquires
 * `dispatchRelayedAt` must LEAVE the candidate set. That is a claim about a
 * predicate over committed rows, which no unit test can make.
 *
 * **The grace window and the join are both SQL conjuncts**, so a work inside the
 * window, or one with no `shipped` claim at all, must not be selected. A `picked`
 * claim in particular must not qualify — the join keys on `eventKind`, and getting
 * that wrong would re-relay a dispatch for a parcel that has not left.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_RELAY_RECONCILE_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentRelayReconcileService,
} from '@openlinker/core/fulfillment';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

/**
 * The repository port is deliberately off the barrel (a `*RepositoryPort` is an
 * intra-context contract), so this test resolves the token against a local
 * structural type — the `fulfillment-timeout-sweep.int-spec.ts` shape.
 */
interface WorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  claimDispatchRelay(workId: string, at: Date): Promise<boolean>;
  findById(workId: string): Promise<FulfillmentWork | null>;
}

const GRACE_MS = 15 * 60 * 1000;
const STUCK_AFTER_MS = 24 * 60 * 60 * 1000;
const HOLDER = '11111111-1111-1111-1111-111111111111';

describe('Dispatch-relay reconcile frontier (#2728)', () => {
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

  const repository = (): WorkRepositoryView =>
    harness.getApp().get<WorkRepositoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);

  const reconcile = (): IFulfillmentRelayReconcileService =>
    harness
      .getApp()
      .get<IFulfillmentRelayReconcileService>(FULFILLMENT_RELAY_RECONCILE_SERVICE_TOKEN);

  const seedWork = async (orderId = 'ol_order_1'): Promise<FulfillmentWork> =>
    repository().create({
      orderId,
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: HOLDER,
      lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: 2 }],
    });

  /**
   * Write a progress claim exactly as `FulfillmentProgressService` would, then
   * backdate it — the sweep's clock is the claim's `claimedAt`, not the work's.
   */
  const seedProgressClaim = async (
    workId: string,
    eventKind: string,
    minutesAgo: number,
    idempotencyKey = `vendor-${eventKind}-${workId}`
  ): Promise<void> => {
    await harness
      .getDataSource()
      .query(
        `INSERT INTO "fulfillment_progress_claims"
           ("workId", "idempotencyKey", "connectionId", "eventKind", "claimedAt")
         VALUES ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)`,
        [workId, idempotencyKey, HOLDER, eventKind, String(minutesAgo)]
      );
  };

  const countClaims = async (workId: string): Promise<number> => {
    const rows = await harness
      .getDataSource()
      .query<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count FROM "fulfillment_progress_claims" WHERE "workId" = $1`,
        [workId]
      );
    return Number(rows[0]?.count ?? '0');
  };

  const list = () =>
    reconcile().listUnrelayedDispatches({
      limit: 25,
      graceMs: GRACE_MS,
      stuckAfterMs: STUCK_AFTER_MS,
      now: new Date(),
    });

  it('should select a shipped work whose dispatch relay never landed', async () => {
    const work = await seedWork();
    await seedProgressClaim(work.id, 'shipped', 60);

    const page = await list();

    expect(page.candidates.map((entry) => entry.intent.workId)).toEqual([work.id]);
    expect(page.candidates[0]?.orderId).toBe('ol_order_1');
  });

  it('should leave the progress claim burnt after the frontier read and a relay (AC2)', async () => {
    // The durable half of AC2. The work is relayed through the SAME conditional
    // claim the ordinary path takes, and the progress claim row must survive it —
    // otherwise a replayed vendor event would be honoured again and re-move
    // counters, which is the failure #2400 designed that key to prevent.
    const work = await seedWork();
    await seedProgressClaim(work.id, 'shipped', 60, 'vendor-evt-7');
    expect(await countClaims(work.id)).toBe(1);

    await list();
    await repository().claimDispatchRelay(work.id, new Date());

    expect(await countClaims(work.id)).toBe(1);

    // And the key is still un-reclaimable, which is what "burnt" means.
    await expect(
      harness
        .getDataSource()
        .query(
          `INSERT INTO "fulfillment_progress_claims"
             ("workId", "idempotencyKey", "connectionId", "eventKind", "claimedAt")
           VALUES ($1, $2, $3, 'shipped', now())`,
          [work.id, 'vendor-evt-7', HOLDER]
        )
    ).rejects.toThrow();
  });

  it('should DROP a work out of the frontier once its relay lands', async () => {
    // Frontier-as-query: the predicate is the cursor, so a repaired row must leave
    // the set. This is what makes an advancing scan offset unnecessary — and what
    // would make one a correctness bug.
    const work = await seedWork();
    await seedProgressClaim(work.id, 'shipped', 60);
    expect((await list()).candidates).toHaveLength(1);

    await repository().claimDispatchRelay(work.id, new Date());

    expect((await list()).candidates).toEqual([]);
  });

  it('should not select a work still inside the grace window', async () => {
    // `dispatchRelayedAt IS NULL` is a legitimate state for the whole duration of
    // a live relay, so racing every fresh `shipped` event is waste.
    const work = await seedWork();
    await seedProgressClaim(work.id, 'shipped', 1);

    expect((await list()).candidates).toEqual([]);
  });

  it('should not select a work whose only progress claim is a PICKED event', async () => {
    // The join keys on `eventKind`. Getting it wrong would relay a dispatch for a
    // parcel that has not left the building.
    const work = await seedWork();
    await seedProgressClaim(work.id, 'picked', 60);

    expect((await list()).candidates).toEqual([]);
  });

  it('should not select a work with no progress claim at all', async () => {
    await seedWork();

    expect((await list()).candidates).toEqual([]);
  });

  it('should report ONE candidate for a work that reported shipped twice, aged from the FIRST', async () => {
    // Two candidates for one work would spend a second relay call to be told
    // `already-relayed`; and the operator-facing harm started at the first report.
    const work = await seedWork();
    await seedProgressClaim(work.id, 'shipped', 90, 'vendor-evt-a');
    await seedProgressClaim(work.id, 'shipped', 30, 'vendor-evt-b');

    const page = await list();

    expect(page.candidates).toHaveLength(1);
    const shippedMinutesAgo = (Date.now() - (page.candidates[0]?.shippedAt.getTime() ?? 0)) / 60_000;
    expect(shippedMinutesAgo).toBeGreaterThan(60);
  });

  it('should order oldest-shipped first', async () => {
    const older = await seedWork('ol_order_older');
    const newer = await seedWork('ol_order_newer');
    await seedProgressClaim(older.id, 'shipped', 600);
    await seedProgressClaim(newer.id, 'shipped', 60);

    const page = await list();

    expect(page.candidates.map((entry) => entry.intent.workId)).toEqual([older.id, newer.id]);
  });

  it('should classify a long-unrelayed work as stuck (AC4)', async () => {
    const work = await seedWork();
    await seedProgressClaim(work.id, 'shipped', 48 * 60);

    const page = await list();

    expect(page.candidates[0]?.stuck).toBe(true);
    expect(page.stuckCount).toBe(1);
    expect(page.stuckAfterMs).toBe(STUCK_AFTER_MS);
  });

  it('should respect the page budget', async () => {
    for (let index = 0; index < 3; index += 1) {
      const work = await seedWork(`ol_order_${String(index)}`);
      await seedProgressClaim(work.id, 'shipped', 60 + index);
    }

    const page = await reconcile().listUnrelayedDispatches({
      limit: 2,
      graceMs: GRACE_MS,
      stuckAfterMs: STUCK_AFTER_MS,
      now: new Date(),
    });

    expect(page.candidates).toHaveLength(2);
  });
});
