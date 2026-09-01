/**
 * Fulfillment Work Transitions Integration Test (#2392, ADR-054, DESIGN §6.3)
 *
 * The writer-discipline half of #2392, exercised through the real repository
 * against real Postgres.
 *
 * Two properties here CANNOT be proved by a unit suite, and are the reason this
 * file exists rather than more mocks:
 *
 *  1. **A stale-precondition transition reports "not applied" and mutates
 *     nothing.** A mock can assert the return value; only a database can show
 *     that the row is genuinely untouched afterwards.
 *  2. **The ≤10 active-hold cap holds under CONCURRENCY.** This is the one that
 *     matters. Postgres defaults to READ COMMITTED, so two overlapping
 *     `placeHold` transactions each counting nine active holds both see nine —
 *     the other's INSERT is uncommitted and invisible — and both insert,
 *     leaving ELEVEN active holds with no error raised anywhere.
 *
 *     **A SEQUENTIAL test passes against that broken implementation**, because
 *     the second call sees the first one's committed row. So a sequential test
 *     is not weaker evidence here, it is NO evidence: its result cannot
 *     distinguish the defect from its absence. Do not "simplify" the concurrent
 *     case below into a sequential one for speed — that would silently retire
 *     the only check that proves the `FOR UPDATE` lock on the parent work row is
 *     doing anything at all.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  FulfillmentHoldAlreadyReleasedError,
  FulfillmentHoldLimitExceededError,
  FulfillmentHoldNotFoundError,
} from '@openlinker/core/fulfillment';
import type {
  CreateFulfillmentWorkInput,
  FulfillmentHold,
  FulfillmentWork,
  PlaceFulfillmentHoldInput,
  RecordFulfillmentLineProgressInput,
  ReleaseFulfillmentHoldInput,
  TransitionFulfillmentRequestStatusInput,
  TransitionFulfillmentWorkStatusInput,
  CancelFulfillmentWorkInput,
  ClaimFulfillmentDispatchInput,
} from '@openlinker/core/fulfillment';

/**
 * A LOCAL structural view of the repository, not the port type.
 *
 * `FulfillmentWorkRepositoryPort` is intra-context and is deliberately absent
 * from the barrel — `check-cross-context-imports` rejects a `*RepositoryPort`
 * by deny pattern. This mirrors `diagnostic-holds-are-inert.int-spec.ts`, which
 * resolves `RESERVATION_REPOSITORY_TOKEN` against its own local shape for the
 * same reason. The INPUT types are published, so only the method list is
 * restated here.
 */
interface FulfillmentWorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  findById(workId: string): Promise<FulfillmentWork | null>;
  transitionStatus(input: TransitionFulfillmentWorkStatusInput): Promise<boolean>;
  transitionRequestStatus(input: TransitionFulfillmentRequestStatusInput): Promise<boolean>;
  findByOrderId(orderId: string): Promise<FulfillmentWork[]>;
  assignHolder(workId: string, connectionId: string): Promise<boolean>;
  clearHolder(workId: string): Promise<boolean>;
  claimDispatchAttempt(input: ClaimFulfillmentDispatchInput): Promise<number | null>;
  claimDispatchRelay(workId: string, at: Date): Promise<boolean>;
  cancel(input: CancelFulfillmentWorkInput): Promise<boolean>;
  recordLineProgress(input: RecordFulfillmentLineProgressInput): Promise<boolean>;
  placeHold(input: PlaceFulfillmentHoldInput): Promise<FulfillmentHold>;
  releaseHold(input: ReleaseFulfillmentHoldInput): Promise<FulfillmentHold>;
  listActiveHolds(workId: string): Promise<FulfillmentHold[]>;
}

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Fulfillment Work Transitions Integration', () => {
  let harness: IntegrationTestHarness;
  let repository: FulfillmentWorkRepositoryView;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness
      .getApp()
      .get<FulfillmentWorkRepositoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  const createWork = async (overrides: { assignedConnectionId?: string | null } = {}) =>
    repository.create({
      orderId: 'ol_order_transitions',
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: overrides.assignedConnectionId ?? null,
      lines: [{ orderLineId: 'line-1', productVariantId: 'ol_variant_1', totalQuantity: 5 }],
    });

  describe('create', () => {
    it('should write the header and its lines together', async () => {
      const work = await createWork();

      expect(work.id).toMatch(/^ol_fulfillmentwork_/);
      expect(work.lines).toHaveLength(1);
      expect(work.status).toBe('open');
      expect(work.requestStatus).toBe('unsubmitted');
      expect(work.version).toBe(0);
      expect(work.cancelledAt).toBeNull();
      expect(work.dispatchRelayedAt).toBeNull();
    });

    it('should leave NO header behind when a line violates the capacity CHECK', async () => {
      // A work without its lines is not a work, so a partial write must never be
      // observable. The CHECK is the trigger; atomicity is what is under test.
      // Scoped to this test's own order rather than counting the whole table:
      // a global count passes only because `afterEach` truncates, silently
      // coupling the assertion to truncation order.
      const countForOrder = async (): Promise<string> => {
        const rows = (await harness
          .getDataSource()
          .query(`SELECT count(*)::text AS count FROM "fulfillment_works" WHERE "orderId" = $1`, [
            'ol_order_atomic',
          ])) as { count: string }[];
        return rows[0].count;
      };
      const before = await countForOrder();

      await expect(
        repository.create({
          orderId: 'ol_order_atomic',
          locationId: null,
          deliveryMethod: null,
          assignedConnectionId: null,
          lines: [{ orderLineId: 'bad', productVariantId: 'ol_variant_1', totalQuantity: -1 }],
        })
      ).rejects.toBeDefined();

      expect(await countForOrder()).toBe(before);
    });
  });

  describe('conditional axis transitions', () => {
    it('should apply once and report not-applied on a stale repeat', async () => {
      const work = await createWork();

      await expect(
        repository.transitionStatus({ workId: work.id, from: ['open'], to: 'scheduled' })
      ).resolves.toBe(true);

      // The precondition no longer holds — the row has moved on.
      await expect(
        repository.transitionStatus({ workId: work.id, from: ['open'], to: 'in_progress' })
      ).resolves.toBe(false);

      const after = await repository.findById(work.id);
      expect(after?.status).toBe('scheduled');
    });

    it('should not mutate the row when a transition is not applied', async () => {
      const work = await createWork();
      await repository.transitionStatus({ workId: work.id, from: ['open'], to: 'scheduled' });
      const before = await repository.findById(work.id);

      await repository.transitionStatus({ workId: work.id, from: ['open'], to: 'closed' });

      const after = await repository.findById(work.id);
      expect(after?.status).toBe(before?.status);
      // The version is a STATE-CHANGE counter, not a write counter — a
      // not-applied transition must leave it alone, or #2406's 409 contract
      // would report a stale token to a caller that changed nothing.
      expect(after?.version).toBe(before?.version);
    });

    it('should bump the version on each applied transition', async () => {
      const work = await createWork();
      expect(work.version).toBe(0);

      await repository.transitionStatus({ workId: work.id, from: ['open'], to: 'scheduled' });
      expect((await repository.findById(work.id))?.version).toBe(1);

      await repository.transitionRequestStatus({
        workId: work.id,
        from: ['unsubmitted'],
        to: 'submitted',
      });
      expect((await repository.findById(work.id))?.version).toBe(2);
    });

    it('should claim the holder exactly once', async () => {
      const work = await createWork();
      const connectionId = '11111111-1111-1111-1111-111111111111';

      await expect(repository.assignHolder(work.id, connectionId)).resolves.toBe(true);
      // A second router run must not steal assigned work.
      await expect(
        repository.assignHolder(work.id, '22222222-2222-2222-2222-222222222222')
      ).resolves.toBe(false);
      expect((await repository.findById(work.id))?.assignedConnectionId).toBe(connectionId);
    });

    it('should claim the dispatch relay exactly once', async () => {
      const work = await createWork();
      const at = new Date();

      await expect(repository.claimDispatchRelay(work.id, at)).resolves.toBe(true);
      await expect(repository.claimDispatchRelay(work.id, new Date())).resolves.toBe(false);
    });

    it('should record a cancellation with its reason and refuse to re-cancel', async () => {
      const work = await createWork();

      await expect(
        repository.cancel({
          workId: work.id,
          reason: 'operator_forced',
          cancelledAt: new Date(),
        })
      ).resolves.toBe(true);

      const cancelled = await repository.findById(work.id);
      expect(cancelled?.status).toBe('cancelled');
      // ADR-054: a force-close lands on `cancelled`, never `closed`-as-completed,
      // and always carries a reason.
      expect(cancelled?.cancellationReason).toBe('operator_forced');
      expect(cancelled?.cancelledAt).not.toBeNull();

      await expect(
        repository.cancel({
          workId: work.id,
          reason: 'operator_forced',
          cancelledAt: new Date(),
        })
      ).resolves.toBe(false);
    });

    it('should move the line counters without touching a status', async () => {
      const work = await createWork();

      await expect(
        repository.recordLineProgress({
          workId: work.id,
          orderLineId: 'line-1',
          fulfilledDelta: 3,
          cancelledDelta: 0,
        })
      ).resolves.toBe(true);

      const after = await repository.findById(work.id);
      expect(after?.lines[0].fulfilledQuantity).toBe(3);
      expect(after?.lines[0].cancelledQuantity).toBe(0);
    });

    it('should let the capacity CHECK refuse a progress delta that would over-fulfil', async () => {
      // Reported as a failure rather than silently clamped: a holder claiming
      // more than was asked for is a real disagreement, not a rounding error.
      const work = await createWork();

      await expect(
        repository.recordLineProgress({
          workId: work.id,
          orderLineId: 'line-1',
          fulfilledDelta: 99,
          cancelledDelta: 0,
        })
      ).rejects.toBeDefined();
    });
  });

  describe('previously untested transitions', () => {
    it('should clear the holder only when one is set', async () => {
      // The rejection path ADR-054 leans on. Its `IS NOT NULL` guard was
      // untested, so a clearHolder that cleared unconditionally looked fine.
      const work = await createWork();
      await expect(repository.clearHolder(work.id)).resolves.toBe(false);

      await repository.assignHolder(work.id, '11111111-1111-1111-1111-111111111111');
      await expect(repository.clearHolder(work.id)).resolves.toBe(true);
      expect((await repository.findById(work.id))?.assignedConnectionId).toBeNull();
    });

    it('should increment the assignment attempt monotonically as it claims', async () => {
      // #2392's `incrementAssignmentAttempt` was the one "transition" with no
      // precondition beyond the id. #2399 REPLACED it: an unguarded bump could
      // move the counter out from under a live `submitted` dispatch and
      // invalidate an in-flight idempotency key — a re-minted key being a second
      // fulfilment request to a 3PL. The claim now carries the state guard, and
      // the attempt comes back from the statement that wrote it.
      const work = await createWork();
      expect(work.assignmentAttempt).toBe(0);

      await expect(
        repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] })
      ).resolves.toBe(1);
      // The second claim is the RE-REQUEST arm: only a rejected work may be
      // re-offered, which is what stops a bump landing on a live dispatch.
      await expect(
        repository.transitionRequestStatus({
          workId: work.id,
          from: ['submitted'],
          to: 'rejected',
        })
      ).resolves.toBe(true);
      await expect(
        repository.claimDispatchAttempt({ workId: work.id, from: ['rejected'] })
      ).resolves.toBe(2);

      const reloaded = await repository.findById(work.id);
      expect(reloaded?.assignmentAttempt).toBe(2);
      expect(reloaded?.requestStatus).toBe('submitted');
    });

    it('should refuse to claim a work already submitted, leaving the counter alone', async () => {
      const work = await createWork();
      await expect(
        repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] })
      ).resolves.toBe(1);

      // The guard that keeps ONE dispatch per attempt: a second claim from the
      // same `from` set matches nothing, and must not bump the counter.
      await expect(
        repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted', 'rejected'] })
      ).resolves.toBeNull();
      expect((await repository.findById(work.id))?.assignmentAttempt).toBe(1);
    });

    it('should report not-claimed for an unknown work, and for an empty from-set', async () => {
      await expect(
        repository.claimDispatchAttempt({
          workId: 'ol_fulfillmentwork_missing',
          from: ['unsubmitted'],
        })
      ).resolves.toBeNull();
      // `IN ()` is a syntax error, not an empty set — a transition FROM nothing
      // can never apply, so the honest answer is "not claimed".
      await expect(
        repository.claimDispatchAttempt({ workId: 'ol_fulfillmentwork_missing', from: [] })
      ).resolves.toBeNull();
    });

    it('should return every work for an order with ITS OWN lines', async () => {
      // The two works are given DISTINGUISHABLE lines on purpose. With identical
      // ones, an implementation that swapped the lines between headers passes a
      // cardinality check — so `lines.filter(l => l.fulfillmentWorkId === header.id)`
      // would be untested for the property that matters. #2395 leans on this read.
      const first = await createWork();
      const second = await repository.create({
        orderId: 'ol_order_transitions',
        locationId: 'ol_location_2',
        deliveryMethod: 'pickup',
        assignedConnectionId: null,
        lines: [{ orderLineId: 'line-2', productVariantId: 'ol_variant_2', totalQuantity: 7 }],
      });

      const found = await repository.findByOrderId('ol_order_transitions');
      expect(found).toHaveLength(2);
      expect(found.find((w) => w.id === first.id)?.lines.map((l) => l.orderLineId)).toEqual([
        'line-1',
      ]);
      expect(found.find((w) => w.id === second.id)?.lines.map((l) => l.orderLineId)).toEqual([
        'line-2',
      ]);
    });

    it('should refuse a duplicate order line within one create', async () => {
      // `UQ_fulfillment_work_lines_work_order_line` asserted against the real
      // database, and the error must NAME the offending line.
      await expect(
        repository.create({
          orderId: 'ol_order_dupe',
          locationId: null,
          deliveryMethod: null,
          assignedConnectionId: null,
          lines: [
            { orderLineId: 'dup', productVariantId: 'v1', totalQuantity: 1 },
            { orderLineId: 'dup', productVariantId: 'v2', totalQuantity: 1 },
          ],
        })
      ).rejects.toMatchObject({ name: 'DuplicateFulfillmentWorkLineError', orderLineId: 'dup' });
    });

    it('should advance updatedAt on an applied transition and leave it alone on a stale one', async () => {
      // `IDX_fulfillment_works_request_status` is sized for ADR-054's
      // timeout-as-rejection sweep, which scans `updatedAt`. If a transition did
      // not move that column the sweep would re-select the same rows forever.
      const work = await createWork();
      const initial = (await repository.findById(work.id))?.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 10));
      await repository.transitionRequestStatus({
        workId: work.id,
        from: ['unsubmitted'],
        to: 'submitted',
      });
      const advanced = (await repository.findById(work.id))?.updatedAt;
      expect(advanced?.getTime()).toBeGreaterThan(initial!.getTime());

      await new Promise((resolve) => setTimeout(resolve, 10));
      await repository.transitionRequestStatus({
        workId: work.id,
        from: ['unsubmitted'],
        to: 'accepted',
      });
      expect((await repository.findById(work.id))?.updatedAt?.getTime()).toBe(advanced!.getTime());
    });
  });

  describe('hold cap under concurrency', () => {
    it('should block a placeHold while the parent work row is locked elsewhere', async () => {
      // ## This is the test that proves the lock. Read before changing it.
      //
      // The obvious version — fire two `placeHold` promises without awaiting
      // and assert one loses — **passes with the lock removed**, verified. Two
      // promises started together do not reliably interleave at the critical
      // section, so that test's result cannot distinguish the defect from its
      // absence: it is not weak evidence, it is none.
      //
      // So the lock is tested for what it actually does. An independent
      // transaction takes `FOR UPDATE` on the parent work row; `placeHold` must
      // then BLOCK, because it asks for the same lock before counting. Without
      // `setLock('pessimistic_write')` it sails past and resolves immediately,
      // which is the red this asserts against.
      //
      // (The connection pool is 10 by default, so a single held connection
      // cannot be what blocks us — the block is the row lock, not starvation.)
      const work = await createWork();

      const runner = harness.getDataSource().createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      await runner.query('SELECT "id" FROM "fulfillment_works" WHERE "id" = $1 FOR UPDATE', [
        work.id,
      ]);

      let settled = false;
      const pending = repository
        .placeHold({
          workId: work.id,
          reason: 'operator',
          placedByService: 'blocked-racer',
          placedAt: new Date(),
        })
        .then((hold) => {
          settled = true;
          return hold;
        });

      // Generous enough that an UNLOCKED implementation would certainly have
      // finished — the insert itself takes single-digit milliseconds.
      await new Promise((resolve) => setTimeout(resolve, 750));

      // Released in `finally` so a FAILING assertion cannot leave the row
      // locked: without this the pending placeHold never settles and the suite
      // sits until the 120 s jest timeout, turning a one-line diagnosis into a
      // two-minute one. (Observed while proving this test red.)
      try {
        expect(settled).toBe(false);
      } finally {
        await runner.commitTransaction();
        await runner.release();
      }

      await expect(pending).resolves.toBeDefined();
      expect(await repository.listActiveHolds(work.id)).toHaveLength(1);
    });

    it('should never exceed the active limit when many placeHold calls are issued together', async () => {
      // ## SMOKE TEST. This does NOT prove the lock. Do not delete the test above.
      //
      // This one is fast and reads like a concurrency test; the one above is
      // slow (it deliberately waits 750 ms) and reads like a formality. That is
      // exactly backwards, and the trap for anyone trimming a slow suite:
      //
      //   - THIS test was verified to PASS with `setLock('pessimistic_write')`
      //     removed from `placeHold`. Un-awaited promises do not reliably
      //     interleave at the critical section, so its result cannot
      //     distinguish the defect from its absence.
      //   - The test ABOVE was verified to FAIL without the lock
      //     (`Expected: false, Received: true`) and pass with it.
      //
      // Keeping only the fast one leaves the guard silently not guarding. What
      // this test IS good for: an off-by-one in the cap comparison itself,
      // which the deterministic test does not exercise.
      const work = await createWork();
      for (let i = 0; i < 8; i += 1) {
        await repository.placeHold({
          workId: work.id,
          reason: 'operator',
          placedByService: `svc-${i}`,
          placedAt: new Date(),
        });
      }

      const settled = await Promise.allSettled(
        Array.from({ length: 5 }, (_unused, i) =>
          repository.placeHold({
            workId: work.id,
            reason: 'operator',
            placedByService: `racer-${i}`,
            placedAt: new Date(),
          })
        )
      );

      const accepted = settled.filter((r) => r.status === 'fulfilled');
      expect(accepted).toHaveLength(2);
      for (const rejection of settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected'
      )) {
        expect(rejection.reason).toBeInstanceOf(FulfillmentHoldLimitExceededError);
      }

      // The invariant an operator would care about: never eleven.
      expect(await repository.listActiveHolds(work.id)).toHaveLength(10);
    });
  });

  describe('holds', () => {
    it('should release an open hold and refuse a second release', async () => {
      const work = await createWork();
      const hold = await repository.placeHold({
        workId: work.id,
        reason: 'operator',
        placedByUserId: 'user-1',
        placedAt: new Date(),
      });

      const released = await repository.releaseHold({
        holdId: hold.id,
        releasedAt: new Date(),
        releasedByUserId: 'user-2',
      });
      // `releaseHold` maps a RAW `RETURNING *` driver row through `toHoldDomain`
      // — the one place in the repository where a column/property mismatch
      // yields `undefined` silently rather than throwing. Asserting a single
      // field would not catch that.
      expect(released.releasedAt).not.toBeNull();
      expect(released.id).toBe(hold.id);
      expect(released.fulfillmentWorkId).toBe(work.id);
      expect(released.reason).toBe('operator');
      expect(released.placedByUserId).toBe('user-1');
      expect(released.releasedByUserId).toBe('user-2');

      // The two zero-row causes asserted APART — distinguishing them is the
      // entire reason this method throws instead of returning a boolean, so
      // `toBeDefined()` would let an implementation that collapsed or swapped
      // them pass.
      await expect(
        repository.releaseHold({ holdId: hold.id, releasedAt: new Date() })
      ).rejects.toBeInstanceOf(FulfillmentHoldAlreadyReleasedError);

      await expect(
        repository.releaseHold({
          holdId: '00000000-0000-0000-0000-0000000000ff',
          releasedAt: new Date(),
        })
      ).rejects.toBeInstanceOf(FulfillmentHoldNotFoundError);

      expect(await repository.listActiveHolds(work.id)).toHaveLength(0);
    });

    it('should free a slot when a hold is released', async () => {
      // Release must return capacity, or a work object becomes permanently
      // un-holdable after ten holds in its lifetime — the liveness bug the
      // partial-index reasoning on `order_holds` calls out.
      const work = await createWork();
      const holds = [];
      for (let i = 0; i < 10; i += 1) {
        holds.push(
          await repository.placeHold({
            workId: work.id,
            reason: 'operator',
            placedByService: `svc-${i}`,
            placedAt: new Date(),
          })
        );
      }

      await expect(
        repository.placeHold({
          workId: work.id,
          reason: 'operator',
          placedByService: 'over',
          placedAt: new Date(),
        })
      ).rejects.toBeInstanceOf(FulfillmentHoldLimitExceededError);

      await repository.releaseHold({ holdId: holds[0].id, releasedAt: new Date() });

      await expect(
        repository.placeHold({
          workId: work.id,
          reason: 'operator',
          placedByService: 'after-release',
          placedAt: new Date(),
        })
      ).resolves.toBeDefined();
    });
  });
});
