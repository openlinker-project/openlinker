/**
 * ADR-054's timeout-as-rejection sweep (#2712) — integration
 *
 * Drives the real service against real Postgres. Three things only a database
 * can settle, and one of them is the issue's own acceptance criterion.
 *
 * **AC2 is asserted with an OVERLAPPING race, not a sequential one.** #2399
 * records the rule for exactly this shape: a sequential test passes against an
 * implementation with no guard at all, so it is not weaker evidence, it is
 * none. A late holder acceptance and the sweep's reap are issued concurrently
 * against ONE row, and the assertion is that exactly one of them applies.
 *
 * **The frontier is frontier-as-query**, so a reaped row must LEAVE the
 * candidate set. That is a claim about a predicate over committed rows, which
 * no unit test can make.
 *
 * **And the attempt pin is a SQL conjunct**, so a mismatch must write nothing.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_DISPATCH_TIMEOUT_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentDispatchTimeoutService,
} from '@openlinker/core/fulfillment';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

/**
 * The repository port is deliberately off the barrel (a `*RepositoryPort` is an
 * intra-context contract), so this test resolves the token against a local
 * structural type — the `bench-work.int-spec.ts` shape.
 */
interface WorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  claimDispatchAttempt(input: {
    workId: string;
    from: readonly string[];
  }): Promise<number | null>;
  recordAcceptance(input: {
    workId: string;
    acceptedAt: Date | null;
    externalWorkId: string | null;
  }): Promise<boolean>;
  findById(workId: string): Promise<FulfillmentWork | null>;
}

const TIMEOUT_MS = 2 * 60 * 60 * 1000;

describe('Fulfilment dispatch timeout sweep (#2712)', () => {
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

  const sweep = (): IFulfillmentDispatchTimeoutService =>
    harness
      .getApp()
      .get<IFulfillmentDispatchTimeoutService>(FULFILLMENT_DISPATCH_TIMEOUT_SERVICE_TOKEN);

  /** A work in `submitted`, claimed through the REAL handshake claim. */
  const seedSubmitted = async (orderId = 'ol_order_1'): Promise<FulfillmentWork> => {
    const work = await repository().create({
      orderId,
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: '11111111-1111-1111-1111-111111111111',
      lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: 2 }],
    });
    const attempt = await repository().claimDispatchAttempt({
      workId: work.id,
      from: ['unsubmitted', 'rejected'],
    });
    expect(attempt).not.toBeNull();
    return work;
  };

  /** Backdate `updatedAt` so the row falls into the frontier. */
  const makeIdle = async (workId: string, hoursAgo: number): Promise<void> => {
    await harness
      .getDataSource()
      .query(
        `UPDATE "fulfillment_works" SET "updatedAt" = now() - ($2 || ' hours')::interval WHERE "id" = $1`,
        [workId, String(hoursAgo)]
      );
  };

  const reap = () =>
    sweep().reapTimedOutDispatches({ limit: 200, timeoutMs: TIMEOUT_MS, now: new Date() });

  it('should reap an idle submitted dispatch into rejected', async () => {
    const work = await seedSubmitted();
    await makeIdle(work.id, 6);

    const result = await reap();

    expect(result.reaped).toBe(1);
    const after = await repository().findById(work.id);
    expect(after?.requestStatus).toBe('rejected');
  });

  it('should NOT reap a dispatch that is still inside its window', async () => {
    const work = await seedSubmitted();
    await makeIdle(work.id, 1);

    const result = await reap();

    expect(result.examined).toBe(0);
    expect((await repository().findById(work.id))?.requestStatus).toBe('submitted');
  });

  it('should record a NON-blocking rejection row naming the holder', async () => {
    const work = await seedSubmitted();
    await makeIdle(work.id, 6);

    await reap();

    const rows = (await harness
      .getDataSource()
      .query(
        `SELECT "reason", "blocking", "connectionId", "detail" FROM "fulfillment_work_rejections" WHERE "fulfillmentWorkId" = $1`,
        [work.id]
      )) as Array<{
      reason: string;
      blocking: boolean;
      connectionId: string;
      detail: string | null;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe('openlinker:dispatch-timeout');
    // The decision the whole slice turns on: a silence is OUR inference, so it
    // must never exclude the holder from re-sourcing.
    expect(rows[0].blocking).toBe(false);
    expect(rows[0].connectionId).toBe('11111111-1111-1111-1111-111111111111');
    expect(rows[0].detail).toContain('2 hours');
  });

  it('should leave a reaped row OUT of the next run’s frontier (frontier-as-query)', async () => {
    // The property that makes an offset unnecessary AND unsafe: the candidate
    // set consumes its own selection.
    const work = await seedSubmitted();
    await makeIdle(work.id, 6);

    const first = await reap();
    expect(first.reaped).toBe(1);

    const second = await reap();
    expect(second.examined).toBe(0);
    expect(second.reaped).toBe(0);
  });

  it('should let a LATE holder acceptance and the sweep race, with exactly one winner (AC2)', async () => {
    // OVERLAPPING, deliberately. Both statements guard on
    // `requestStatus = 'submitted'`, so Postgres serialises them on the row and
    // the loser re-evaluates its WHERE against the committed row and matches
    // zero. A sequential ordering would pass against no guard at all.
    const work = await seedSubmitted();
    await makeIdle(work.id, 6);

    const [acceptance, sweepResult] = await Promise.all([
      repository().recordAcceptance({
        workId: work.id,
        acceptedAt: null,
        externalWorkId: 'vendor-1',
      }),
      reap(),
    ]);

    const reaped = sweepResult.reaped === 1;
    // Exactly one, never both — that is the double-ship guard.
    expect([acceptance, reaped].filter(Boolean)).toHaveLength(1);

    const after = await repository().findById(work.id);
    expect(after?.requestStatus).toBe(acceptance ? 'accepted' : 'rejected');

    // And a rejection row exists only if the reap actually applied — a lost
    // guard must insert nothing (durability and rollback are separate claims).
    const rejections = (await harness
      .getDataSource()
      .query(`SELECT 1 FROM "fulfillment_work_rejections" WHERE "fulfillmentWorkId" = $1`, [
        work.id,
      ])) as unknown[];
    expect(rejections).toHaveLength(reaped ? 1 : 0);

    // The attempt counter never moved, whichever side won.
    expect(after?.assignmentAttempt).toBe(1);
  });

  it('should never move the attempt counter while a work sits in submitted', async () => {
    // What makes the attempt read in the frontier safe to write back.
    const work = await seedSubmitted();
    await makeIdle(work.id, 6);

    const again = await repository().claimDispatchAttempt({
      workId: work.id,
      from: ['unsubmitted', 'rejected'],
    });

    expect(again).toBeNull();
    expect((await repository().findById(work.id))?.assignmentAttempt).toBe(1);
  });

  it('should reap the OLDEST idle dispatch first', async () => {
    const older = await seedSubmitted('ol_order_older');
    const newer = await seedSubmitted('ol_order_newer');
    await makeIdle(older.id, 20);
    await makeIdle(newer.id, 5);

    const result = await sweep().reapTimedOutDispatches({
      limit: 1,
      timeoutMs: TIMEOUT_MS,
      now: new Date(),
    });

    expect(result.examined).toBe(1);
    expect((await repository().findById(older.id))?.requestStatus).toBe('rejected');
    expect((await repository().findById(newer.id))?.requestStatus).toBe('submitted');
  });

  it('should report the A3-X verdict for the order it reaped', async () => {
    const work = await seedSubmitted();
    await makeIdle(work.id, 6);

    const result = await reap();

    expect(result.attentionIntents).toEqual([
      {
        orderId: 'ol_order_1',
        outcome: expect.objectContaining({
          kind: 'blocked',
          reason: 'fulfillment-unaccepted',
        }),
      },
    ]);
  });

  it('should clear the A3-X verdict once the work is accepted again', async () => {
    // Level-triggered, not sticky (#2100). `recomputeAcceptanceAttention` is
    // the same derivation the sweep reports through.
    const work = await seedSubmitted();
    await makeIdle(work.id, 6);
    await reap();

    await expect(sweep().recomputeAcceptanceAttention('ol_order_1')).resolves.toMatchObject({
      kind: 'blocked',
    });

    await repository().claimDispatchAttempt({ workId: work.id, from: ['unsubmitted', 'rejected'] });
    await repository().recordAcceptance({
      workId: work.id,
      acceptedAt: null,
      externalWorkId: null,
    });

    await expect(sweep().recomputeAcceptanceAttention('ol_order_1')).resolves.toEqual({
      kind: 'none',
    });
  });
});
