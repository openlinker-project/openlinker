/**
 * Fulfillment Executor Handshake Integration Test (#2399, `W3a-10`, ADR-054)
 *
 * The properties a unit suite CANNOT prove, exercised through the real
 * repository against real Postgres.
 *
 *  1. **Under CONCURRENCY, exactly one claim wins and the counter moves once.**
 *     This is the whole subject of the issue. `work:{workId}:{attempt}` must be
 *     stable across a job retry, because a re-minted key is a second fulfilment
 *     request to a 3PL — a double-ship. A SEQUENTIAL test passes against an
 *     implementation with no guard at all, because the second caller sees the
 *     first one's committed row; it therefore cannot distinguish the defect from
 *     its absence and is no evidence. Do not simplify the overlapping case below.
 *
 *  2. **A rejection is DURABLE and readable as an exclusion.** `blocking` exists
 *     so re-sourcing can exclude the rejecter — otherwise "re-source plus a
 *     deterministic sort re-picks the refuser forever". Only a database shows
 *     that the refusals ACCUMULATE rather than overwriting, which is the reason
 *     they are a table and not the two columns #2392 deferred.
 *
 *  3. **A LOST reject stamp inserts zero rows.** Durability and rollback are
 *     different assertions: a mock can show the guard returned `false`; only a
 *     database can show the INSERT did not survive it. Without the transaction,
 *     a rejection row would describe a transition that never happened, and the
 *     exclusion read would exclude a holder on a superseded answer.
 *
 *  4. **Acceptance is an at-most-once CLAIM.** `WHERE "acceptedAt" IS NULL` is
 *     the conjunct that still holds if a future writer moves `requestStatus`
 *     without coming through `recordAcceptance`.
 *
 * @module apps/api/test/integration
 */
import { FULFILLMENT_WORK_REPOSITORY_TOKEN } from '@openlinker/core/fulfillment';
import type {
  ClaimFulfillmentDispatchInput,
  CreateFulfillmentWorkInput,
  FulfillmentWork,
  FulfillmentWorkRejection,
  RecordFulfillmentAcceptanceInput,
  RecordFulfillmentRejectionInput,
  TransitionFulfillmentRequestStatusInput,
} from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/** Local structural view — `*RepositoryPort` is intra-context and unbarreled. */
interface HandshakeRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  findById(workId: string): Promise<FulfillmentWork | null>;
  claimDispatchAttempt(input: ClaimFulfillmentDispatchInput): Promise<number | null>;
  recordAcceptance(input: RecordFulfillmentAcceptanceInput): Promise<boolean>;
  recordRejection(input: RecordFulfillmentRejectionInput): Promise<boolean>;
  listBlockingRejections(workId: string): Promise<FulfillmentWorkRejection[]>;
  transitionRequestStatus(input: TransitionFulfillmentRequestStatusInput): Promise<boolean>;
}

const HOLDER_A = '11111111-1111-1111-1111-111111111111';
const HOLDER_B = '22222222-2222-2222-2222-222222222222';

describe('Fulfillment Executor Handshake Integration', () => {
  let harness: IntegrationTestHarness;
  let repository: HandshakeRepositoryView;

  beforeAll(async () => {
    harness = await getTestHarness();
    repository = harness.getApp().get<HandshakeRepositoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  const createWork = async (): Promise<FulfillmentWork> =>
    repository.create({
      orderId: 'ol_order_handshake',
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: HOLDER_A,
      lines: [{ orderLineId: 'line-1', productVariantId: 'ol_variant_1', totalQuantity: 2 }],
    });

  const rejection = (
    work: FulfillmentWork,
    overrides: Partial<RecordFulfillmentRejectionInput> = {}
  ): RecordFulfillmentRejectionInput => ({
    workId: work.id,
    orderId: work.orderId,
    connectionId: HOLDER_A,
    assignmentAttempt: 1,
    reason: 'no-stock',
    blocking: true,
    detail: null,
    rejectedAt: new Date(),
    ...overrides,
  });

  describe('the claim, under concurrency', () => {
    it('should let exactly ONE of two overlapping claims win, incrementing once', async () => {
      const work = await createWork();

      // Overlapping, not sequential. At READ COMMITTED the loser blocks on the
      // row lock, re-evaluates its WHERE against the COMMITTED row and matches
      // zero — which is the property under test. With the `requestStatus` guard
      // removed both would claim, yielding attempts 1 and 2 and two distinct
      // idempotency keys for one dispatch: the double-ship.
      const [first, second] = await Promise.all([
        repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted', 'rejected'] }),
        repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted', 'rejected'] }),
      ]);

      const claims = [first, second].filter((value) => value !== null);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toBe(1);

      const reloaded = await repository.findById(work.id);
      expect(reloaded?.assignmentAttempt).toBe(1);
      expect(reloaded?.requestStatus).toBe('submitted');
    });

    it('should return the attempt it PERSISTED, so a key cannot precede its row', async () => {
      const work = await createWork();

      const claimed = await repository.claimDispatchAttempt({
        workId: work.id,
        from: ['unsubmitted'],
      });

      // The attempt reaches a caller only through the statement that wrote it,
      // so minting `work:{id}:{attempt}` ahead of the row is not expressible.
      expect(claimed).toBe((await repository.findById(work.id))?.assignmentAttempt);
    });
  });

  describe('acceptance', () => {
    it('should stamp status, holder instant and external id together', async () => {
      const work = await createWork();
      await repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] });
      const acceptedAt = new Date('2026-08-30T10:00:00.000Z');

      await expect(
        repository.recordAcceptance({ workId: work.id, acceptedAt, externalWorkId: 'WMS-42' })
      ).resolves.toBe(true);

      const reloaded = await repository.findById(work.id);
      expect(reloaded?.requestStatus).toBe('accepted');
      expect(reloaded?.acceptedAt).toEqual(acceptedAt);
      expect(reloaded?.externalWorkId).toBe('WMS-42');
    });

    it('should be an at-most-once claim, refusing a second acceptance', async () => {
      const work = await createWork();
      await repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] });
      await repository.recordAcceptance({
        workId: work.id,
        acceptedAt: new Date('2026-08-30T10:00:00.000Z'),
        externalWorkId: 'WMS-42',
      });

      // Re-driven directly back to `submitted` — which is exactly the future
      // writer `acceptedAt IS NULL` exists to survive. The second acceptance
      // must not overwrite the first holder's reference.
      await repository.transitionRequestStatus({
        workId: work.id,
        from: ['accepted'],
        to: 'submitted',
      });

      await expect(
        repository.recordAcceptance({
          workId: work.id,
          acceptedAt: new Date('2026-08-30T11:00:00.000Z'),
          externalWorkId: 'WMS-99',
        })
      ).resolves.toBe(false);
      expect((await repository.findById(work.id))?.externalWorkId).toBe('WMS-42');
    });

    it('should accept a holder that reports NO instant, without inventing one', async () => {
      const work = await createWork();
      await repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] });

      await expect(
        repository.recordAcceptance({ workId: work.id, acceptedAt: null, externalWorkId: null })
      ).resolves.toBe(true);

      const reloaded = await repository.findById(work.id);
      // At-most-once comes from the conditional UPDATE, never from the column
      // being populated — OL's clock is not a witness to a third party's act.
      expect(reloaded?.requestStatus).toBe('accepted');
      expect(reloaded?.acceptedAt).toBeNull();
    });
  });

  describe('rejection', () => {
    it('should record a blocking rejection durably and read it back as an exclusion', async () => {
      const work = await createWork();
      await repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] });

      await expect(repository.recordRejection(rejection(work))).resolves.toBe(true);

      expect((await repository.findById(work.id))?.requestStatus).toBe('rejected');
      const excluded = await repository.listBlockingRejections(work.id);
      expect(excluded).toHaveLength(1);
      expect(excluded[0].connectionId).toBe(HOLDER_A);
      expect(excluded[0].blocking).toBe(true);
      expect(excluded[0].assignmentAttempt).toBe(1);
      expect(excluded[0].orderId).toBe(work.orderId);
    });

    it('should ACCUMULATE exclusions across holders rather than overwriting', async () => {
      // The reason this is a table and not two columns. A scalar pair holds only
      // the LAST refusal, so A's exclusion is lost and the re-source loop the
      // field exists to terminate runs anyway.
      const work = await createWork();
      await repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] });
      await repository.recordRejection(rejection(work, { connectionId: HOLDER_A }));

      await repository.claimDispatchAttempt({ workId: work.id, from: ['rejected'] });
      await repository.recordRejection(
        rejection(work, { connectionId: HOLDER_B, assignmentAttempt: 2 })
      );

      const excluded = await repository.listBlockingRejections(work.id);
      expect(excluded.map((row) => row.connectionId).sort()).toEqual([HOLDER_A, HOLDER_B]);
    });

    it('should omit a NON-blocking refusal from the exclusion read', async () => {
      const work = await createWork();
      await repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] });

      await repository.recordRejection(rejection(work, { blocking: false }));

      // The refusal happened, but the holder is not excluded from re-sourcing —
      // that distinction IS the field.
      expect(await repository.listBlockingRejections(work.id)).toEqual([]);
      expect((await repository.findById(work.id))?.requestStatus).toBe('rejected');
    });

    it('should insert ZERO rows when the guarded transition loses its race', async () => {
      const work = await createWork();
      await repository.claimDispatchAttempt({ workId: work.id, from: ['unsubmitted'] });
      // A peer records the answer first, so the `submitted -> rejected` guard
      // can no longer apply.
      await repository.transitionRequestStatus({
        workId: work.id,
        from: ['submitted'],
        to: 'accepted',
      });

      await expect(repository.recordRejection(rejection(work))).resolves.toBe(false);

      // Rollback, not merely a `false` return value. Without the transaction the
      // row would survive and exclude a holder on an answer already superseded.
      const rows = (await harness
        .getDataSource()
        .query(`SELECT count(*)::text AS count FROM "fulfillment_work_rejections" WHERE "fulfillmentWorkId" = $1`, [
          work.id,
        ])) as { count: string }[];
      expect(rows[0].count).toBe('0');
      expect((await repository.findById(work.id))?.requestStatus).toBe('accepted');
    });
  });
});
