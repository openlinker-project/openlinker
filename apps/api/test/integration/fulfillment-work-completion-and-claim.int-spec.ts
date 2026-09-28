/**
 * Completion undo, reopen-clears-completion, and the exclusive self-claim
 * (#3340 follow-up)
 *
 * Three defects reproduced live on this branch, each closed by a narrow
 * conditional UPDATE the way every other writer on `fulfillment_works`
 * already is:
 *
 *  1. **A completed parcel could be reopened and then found nowhere.**
 *     `reopenParcel` guarded only on `parcelClosedAt`, so a completed-then-
 *     reopened parcel kept a stale `completedAt` while `parcelClosedAt` went
 *     NULL — a state no list query selects. `reopenParcel` now clears
 *     `completedAt` / `completedByUserId` in the SAME statement.
 *
 *  2. **There was no way to take back a completion alone.** `undoCompletion`
 *     is the mirror of `claimCompletion`: it touches only the completion
 *     pair and leaves `parcelClosedAt` and the whole verification ledger
 *     untouched, unlike `reopenParcel`'s destructive re-verification.
 *
 *  3. **Two concurrent self-claims on one unassigned parcel both reported
 *     `claimed`.** `assignToPacker` is deliberately unconditional (ADR-074's
 *     supervisor reassignment), so `claimAssignment` is the NEW, EXCLUSIVE
 *     writer a packer's own self-claim needs — guarded `WHERE
 *     "assignedToUserId" IS NULL`.
 *
 * The claim race is proved with genuinely concurrent Postgres writes rather
 * than a sequential call: unlike the hold cap (`fulfillment-work-
 * transitions.int-spec.ts`'s count-then-insert, which needs an explicit
 * `FOR UPDATE` lock to serialize), `claimAssignment` is ONE conditional
 * UPDATE statement — Postgres's own per-row lock on the UPDATE already
 * serializes two concurrent statements against the same row, so a plain
 * `Promise.all` reliably exercises the guard with no artificial
 * synchronization needed.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_VERIFICATION_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  type ClaimFulfillmentWorkAssignmentResult,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentVerificationService,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';
import { OMS_PLATFORM_TYPE } from '@openlinker/oms';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';

/** The repository port is off the barrel; see `bench-work.int-spec.ts`. */
interface WorkFactoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  claimAssignment(workId: string, userId: string): Promise<boolean>;
}

interface CompletionRow {
  completedAt: Date | null;
  completedByUserId: string | null;
  parcelClosedAt: Date | null;
  assignedToUserId: string | null;
  version: string | number;
}

const ORDER_ID = 'ol_order_completion_and_claim';
const PACKER_A = '11111111-1111-1111-1111-111111111111';
const PACKER_B = '22222222-2222-2222-2222-222222222222';

describe('Completion undo, reopen-clears-completion, exclusive self-claim (#3340 follow-up)', () => {
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

  async function seedWork(quantity = 1): Promise<FulfillmentWork> {
    const dataSource = harness.getDataSource();
    const oms = await createTestConnection(dataSource, {
      platformType: OMS_PLATFORM_TYPE,
      name: 'Warehouse packing',
      status: 'active',
      adapterKey: null as unknown as undefined,
      credentialsRef: '',
      enabledCapabilities: ['FulfillmentExecutor'],
      config: {},
    });
    const works = harness.getApp().get<WorkFactoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
    const work = await works.create({
      orderId: ORDER_ID,
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: oms.id,
      lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: quantity }],
    });
    await dataSource.query(
      `UPDATE "fulfillment_works" SET "requestStatus" = 'accepted' WHERE "id" = $1`,
      [work.id]
    );
    return work;
  }

  async function readCompletion(workId: string): Promise<CompletionRow> {
    const rows = (await harness
      .getDataSource()
      .query(
        `SELECT "completedAt", "completedByUserId", "parcelClosedAt", "assignedToUserId", "version"
           FROM "fulfillment_works" WHERE "id" = $1`,
        [workId]
      )) as CompletionRow[];
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  function verification(): IFulfillmentVerificationService {
    return harness
      .getApp()
      .get<IFulfillmentVerificationService>(FULFILLMENT_VERIFICATION_SERVICE_TOKEN);
  }

  function worklist(): IFulfillmentWorklistService {
    return harness.getApp().get<IFulfillmentWorklistService>(FULFILLMENT_WORKLIST_SERVICE_TOKEN);
  }

  /** Close the parcel's one line and declare it completed. */
  async function closeAndComplete(workId: string): Promise<void> {
    const service = verification();
    const state = await service.getState(workId);
    await service.verifyUnit({
      workId,
      workLineId: state.lines[0].workLineId,
      gestureId: 'g-close',
      verifiedByUserId: PACKER_A,
    });
    const afterClose = await service.getState(workId);
    const completed = await service.complete({
      workId,
      completedByUserId: PACKER_A,
      expectedVersion: afterClose.version,
    });
    expect(completed).toEqual({ outcome: 'completed' });
  }

  describe('reopenParcel clears a stale completion', () => {
    it('never leaves a completed-then-reopened parcel with a stale completedAt', async () => {
      const work = await seedWork();
      await closeAndComplete(work.id);

      const beforeReopen = await readCompletion(work.id);
      expect(beforeReopen.completedAt).not.toBeNull();
      expect(beforeReopen.completedByUserId).toBe(PACKER_A);

      const result = await verification().reopenParcel({
        workId: work.id,
        reopenedByUserId: PACKER_A,
        hasShipped: false,
      });
      expect(result.outcome).toBe('reopened');

      const afterReopen = await readCompletion(work.id);
      // The regression this test pins: before the fix, `parcelClosedAt` went
      // NULL here while `completedAt` stayed set — a state no bench list
      // query (rail, packed-today, unlabelled-parcels) can find.
      expect(afterReopen.parcelClosedAt).toBeNull();
      expect(afterReopen.completedAt).toBeNull();
      expect(afterReopen.completedByUserId).toBeNull();
    });

    it('bumps version once for the whole reopen, including the completion clear', async () => {
      const work = await seedWork();
      await closeAndComplete(work.id);
      const before = await readCompletion(work.id);

      await verification().reopenParcel({
        workId: work.id,
        reopenedByUserId: PACKER_A,
        hasShipped: false,
      });

      const after = await readCompletion(work.id);
      expect(Number(after.version)).toBe(Number(before.version) + 1);
    });
  });

  describe('undoCompletion — the mirror of claimCompletion', () => {
    it('clears only the completion pair, leaving the parcel closed and the ledger intact', async () => {
      const work = await seedWork();
      await closeAndComplete(work.id);
      const closed = await readCompletion(work.id);

      const result = await verification().undoCompletion({
        workId: work.id,
        expectedVersion: Number(closed.version),
      });
      expect(result).toEqual({ outcome: 'undone' });

      const after = await readCompletion(work.id);
      expect(after.completedAt).toBeNull();
      expect(after.completedByUserId).toBeNull();
      // Unlike `reopenParcel`, the parcel stays closed and the scans stand.
      expect(after.parcelClosedAt).not.toBeNull();
      const counts = await verification().getState(work.id);
      expect(counts.lines[0].verifiedQuantity).toBe(1);
    });

    it('refuses not-completed when there is nothing to undo', async () => {
      const work = await seedWork();
      // Never closed, let alone completed.
      const state = await verification().getState(work.id);

      const result = await verification().undoCompletion({
        workId: work.id,
        expectedVersion: state.version,
      });
      expect(result).toEqual({ outcome: 'refused', reason: 'not-completed' });
    });

    it('refuses version-conflict on a stale token', async () => {
      const work = await seedWork();
      await closeAndComplete(work.id);
      const closed = await readCompletion(work.id);

      const result = await verification().undoCompletion({
        workId: work.id,
        expectedVersion: Number(closed.version) - 1,
      });
      expect(result).toEqual({ outcome: 'refused', reason: 'version-conflict' });
      // Refusing must not have cleared it.
      expect((await readCompletion(work.id)).completedAt).not.toBeNull();
    });

    it('reports refused rather than a false success on a repeat undo', async () => {
      const work = await seedWork();
      await closeAndComplete(work.id);
      const closed = await readCompletion(work.id);

      const first = await verification().undoCompletion({
        workId: work.id,
        expectedVersion: Number(closed.version),
      });
      expect(first.outcome).toBe('undone');

      const afterFirst = await readCompletion(work.id);
      const second = await verification().undoCompletion({
        workId: work.id,
        expectedVersion: Number(afterFirst.version),
      });
      expect(second).toEqual({ outcome: 'refused', reason: 'not-completed' });
    });
  });

  describe('claimAssignment — the exclusive unassigned -> mine transition', () => {
    it('lets only ONE of two concurrent self-claims on an unassigned parcel win', async () => {
      const work = await seedWork();
      expect((await readCompletion(work.id)).assignedToUserId).toBeNull();

      const repository = harness.getApp().get<WorkFactoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
      const [claimedA, claimedB] = await Promise.all([
        repository.claimAssignment(work.id, PACKER_A),
        repository.claimAssignment(work.id, PACKER_B),
      ]);

      // Exactly one true, one false — never both true (the bug reproduced:
      // both callers told `claimed`) and never both false (the write is
      // legal for at least one of them).
      expect([claimedA, claimedB].filter(Boolean)).toHaveLength(1);

      const after = await readCompletion(work.id);
      const winner = claimedA ? PACKER_A : PACKER_B;
      expect(after.assignedToUserId).toBe(winner);
    });

    it('reports the loser honestly through the worklist service, with the FRESH holder', async () => {
      const work = await seedWork();

      const results = await Promise.all([
        worklist().claimAssignment(work.id, PACKER_A),
        worklist().claimAssignment(work.id, PACKER_B),
      ]);

      const winners = results.filter((r) => r.claimed);
      const losers = results.filter((r) => !r.claimed);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);

      // The loser's returned `work` is the FRESH row, not the stale pre-write
      // view — it must show the WINNER as the holder, never `null` and never
      // the loser's own id.
      const winnerId = winners[0]?.work.assignedToUserId;
      expect(winnerId).not.toBeNull();
      expect(losers[0]?.work.assignedToUserId).toBe(winnerId);
    });

    it('does not touch an already-assigned parcel (the transition guard, not blanket exclusivity)', async () => {
      const work = await seedWork();
      const repository = harness.getApp().get<WorkFactoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
      expect(await repository.claimAssignment(work.id, PACKER_A)).toBe(true);

      // A second self-claim by a DIFFERENT packer against an already-assigned
      // row must be refused by THIS writer — it is not the one ADR-074's
      // advisory reassignment goes through (`assignToPacker`, unconditional).
      expect(await repository.claimAssignment(work.id, PACKER_B)).toBe(false);
      expect((await readCompletion(work.id)).assignedToUserId).toBe(PACKER_A);
    });
  });

  // Exercised for completeness so the type import above is proved reachable
  // rather than merely compiling.
  it('claimAssignment result shape matches the published type', async () => {
    const work = await seedWork();
    const result: ClaimFulfillmentWorkAssignmentResult = await worklist().claimAssignment(
      work.id,
      PACKER_A
    );
    expect(result.claimed).toBe(true);
    expect(result.work.id).toBe(work.id);
  });
});
