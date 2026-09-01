/**
 * Fulfillment Worklist Integration Test (#2406, `W3a-19`, DESIGN §5.2, REVIEW C10)
 *
 * The optimistic token, exercised through the real service against real Postgres.
 *
 * ## Why the conflict test is OVERLAPPING, and why it is pinned to `hold`
 *
 * *"Without an optimistic token those actions go stale and a second operator
 * double-ships."* Two things have to be true of a test that proves the guard
 * works, and each rules out an easier test:
 *
 *  1. **It must overlap.** A sequential test — act, then act again with the
 *     now-stale token — passes against NO guard at all, because the second call
 *     sees the first one's committed state. That is the same non-evidence the
 *     sibling `fulfillment-work-transitions.int-spec.ts` warns about for the
 *     hold cap, and the `[1, 2]` shape #2399 hit.
 *
 *  2. **It must use `hold`.** Every other exposed action's underlying write
 *     carries a state guard that already excludes its own post-state
 *     (`transitionStatus` has a `from`, `cancel` has `NOT IN (cancelled, closed)`).
 *     So for `close` or `force_cancel`, two overlapping calls yield
 *     one-fulfil / one-reject **even with the version predicate removed** — the
 *     assertion cannot distinguish the defect from its absence. `hold` is the
 *     only exposed action whose write genuinely succeeds twice, so it is the
 *     only one where the version predicate is the sole thing standing between
 *     one hold row and two.
 *
 * Do not "simplify" either property away.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  FulfillmentWorkActionNotLegalError,
  FulfillmentWorkVersionConflictError,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * A LOCAL structural view of the repository — the port is intra-context and
 * deliberately off the barrel (deny pattern). Only `create` is needed here.
 */
interface WorkFactoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
}

describe('Fulfillment Worklist Integration (#2406)', () => {
  let harness: IntegrationTestHarness;
  let worklist: IFulfillmentWorklistService;
  let works: WorkFactoryView;

  beforeAll(async () => {
    harness = await getTestHarness();
    worklist = harness
      .getApp()
      .get<IFulfillmentWorklistService>(FULFILLMENT_WORKLIST_SERVICE_TOKEN);
    works = harness.getApp().get<WorkFactoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  const createWork = async (orderId = 'ol_order_worklist'): Promise<FulfillmentWork> =>
    works.create({
      orderId,
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: null,
      lines: [{ orderLineId: 'line-1', productVariantId: 'ol_variant_1', totalQuantity: 5 }],
    });

  const countHolds = async (workId: string): Promise<number> => {
    const rows = (await harness
      .getDataSource()
      .query(
        `SELECT count(*)::int AS count FROM "fulfillment_holds"
          WHERE "fulfillmentWorkId" = $1 AND "releasedAt" IS NULL`,
        [workId]
      )) as { count: number }[];
    return rows[0].count;
  };

  describe('the read model', () => {
    it('should return supportedActions and a token with the resource', async () => {
      const work = await createWork();
      const view = await worklist.get(work.id);

      expect(view.version).toBe(work.version);
      expect(view.supportedActions).toEqual(
        expect.arrayContaining(['schedule', 'mark_in_progress', 'hold', 'force_cancel'])
      );
      // Legal on the axes, but not executable here — see OPERATOR_INVOCABLE_ACTIONS.
      expect(view.supportedActions).not.toContain('submit');
      expect(view.lines).toHaveLength(1);
      expect(view.activeHolds).toEqual([]);
    });

    it('should move the token and the action set after a successful action', async () => {
      const work = await createWork();
      const after = await worklist.applyAction({
        workId: work.id,
        action: 'mark_in_progress',
        expectedVersion: work.version,
      });

      expect(after.version).toBeGreaterThan(work.version);
      expect(after.status).toBe('in_progress');
      expect(after.supportedActions).toContain('close');
      expect(after.supportedActions).not.toContain('mark_in_progress');
    });

    it('should filter and bound the list', async () => {
      const a = await createWork('ol_order_a');
      await createWork('ol_order_b');
      await worklist.applyAction({
        workId: a.id,
        action: 'schedule',
        expectedVersion: a.version,
      });

      const scheduled = await worklist.list({ status: ['scheduled'] });
      expect(scheduled.total).toBe(1);
      expect(scheduled.works[0].id).toBe(a.id);

      const byOrder = await worklist.list({ orderId: 'ol_order_b' });
      expect(byOrder.total).toBe(1);

      // Clamped to the domain ceiling, and the applied value is what is reported.
      expect((await worklist.list({ limit: 9999 })).limit).toBe(100);
    });
  });

  describe('the optimistic token under CONCURRENCY', () => {
    it('should let exactly one of two overlapping actions win, and answer the loser 409 with a refreshed set', async () => {
      const work = await createWork();
      const staleToken = work.version;

      // BOTH hold the same starting token. Overlapping, not sequential.
      const [first, second] = await Promise.allSettled([
        worklist.applyAction({
          workId: work.id,
          action: 'hold',
          expectedVersion: staleToken,
          holdReason: 'operator',
          note: 'first',
        }),
        worklist.applyAction({
          workId: work.id,
          action: 'hold',
          expectedVersion: staleToken,
          holdReason: 'operator',
          note: 'second',
        }),
      ]);

      const outcomes = [first.status, second.status].sort();
      expect(outcomes).toEqual(['fulfilled', 'rejected']);

      const rejection = (first.status === 'rejected' ? first : second) as PromiseRejectedResult;
      expect(rejection.reason).toBeInstanceOf(FulfillmentWorkVersionConflictError);

      const conflict = rejection.reason as FulfillmentWorkVersionConflictError;
      expect(conflict.expectedVersion).toBe(staleToken);
      expect(conflict.currentVersion).toBeGreaterThan(staleToken);
      // The refreshed set is what makes the 409 actionable without a second GET,
      // and it reflects the work as it now IS — held.
      expect(conflict.supportedActions).toContain('release_hold');
      expect(conflict.supportedActions).not.toContain('schedule');

      // The actual defect: without the version predicate BOTH holds are written.
      expect(await countHolds(work.id)).toBe(1);
    });

    it('should refuse a stale token on a transition without moving the row', async () => {
      const work = await createWork();
      await worklist.applyAction({
        workId: work.id,
        action: 'schedule',
        expectedVersion: work.version,
      });

      const error = await worklist
        .applyAction({
          workId: work.id,
          action: 'mark_in_progress',
          // The pre-schedule token — stale now.
          expectedVersion: work.version,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FulfillmentWorkVersionConflictError);
      // Nothing moved.
      expect((await worklist.get(work.id)).status).toBe('scheduled');
    });

    it('should report an illegal-but-current action as NOT a stale-token conflict', async () => {
      // `version` counts state changes, not writes: a fresh token whose action
      // is simply not legal must not be reported as somebody-else-moved-it.
      const work = await createWork();
      const current = await worklist.get(work.id);

      const error = await worklist
        .applyAction({
          workId: work.id,
          // Legal only from `in_progress`; this work is `open`.
          action: 'close',
          expectedVersion: current.version,
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FulfillmentWorkActionNotLegalError);
      expect(error).not.toBeInstanceOf(FulfillmentWorkVersionConflictError);
    });
  });

  describe('holds', () => {
    it('should surface an active hold, bump the token, and suppress forward motion', async () => {
      const work = await createWork();
      const held = await worklist.applyAction({
        workId: work.id,
        action: 'hold',
        expectedVersion: work.version,
        holdReason: 'operator',
        note: 'awaiting stock check',
      });

      expect(held.activeHolds).toHaveLength(1);
      expect(held.activeHolds[0].reason).toBe('operator');
      expect(held.version).toBeGreaterThan(work.version);
      expect(held.supportedActions).toContain('release_hold');
      expect(held.supportedActions).not.toContain('mark_in_progress');

      const released = await worklist.applyAction({
        workId: work.id,
        action: 'release_hold',
        expectedVersion: held.version,
        holdId: held.activeHolds[0].id,
      });

      expect(released.activeHolds).toEqual([]);
      expect(released.version).toBeGreaterThan(held.version);
      expect(released.supportedActions).toContain('mark_in_progress');
    });

    // `CHK_fulfillment_holds_actor` is an XOR: EXACTLY one of
    // `placedByUserId` / `placedByService` may be set, so BOTH arms have to be
    // exercised or half the constraint is untested. The test above covers the
    // no-user arm (the service names itself); this one covers the user arm.
    // Before the service filled the service actor in, the no-user arm failed
    // outright on the check constraint — a 500, not a hold.
    it.each([
      ['a user actor', 'ol_user_operator_1'],
      ['no actor at all', undefined],
    ])('should place a hold with %s and satisfy the actor XOR', async (_label, actorUserId) => {
      const work = await createWork();
      const held = await worklist.applyAction({
        workId: work.id,
        action: 'hold',
        expectedVersion: work.version,
        holdReason: 'operator',
        actorUserId,
      });

      expect(held.activeHolds).toHaveLength(1);
      expect(await countHolds(work.id)).toBe(1);

      // Exactly one actor column is populated, whichever arm was taken.
      const rows = (await harness
        .getDataSource()
        .query(
          `SELECT "placedByUserId", "placedByService" FROM "fulfillment_holds"
            WHERE "fulfillmentWorkId" = $1`,
          [work.id]
        )) as { placedByUserId: string | null; placedByService: string | null }[];
      const [row] = rows;
      expect((row.placedByUserId !== null) !== (row.placedByService !== null)).toBe(true);
      expect(row.placedByUserId).toBe(actorUserId ?? null);
    });
  });
});
