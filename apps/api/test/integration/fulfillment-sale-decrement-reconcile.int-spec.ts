/**
 * The sale-decrement reconcile frontier (#3629) - integration
 *
 * The frontier is a SQL predicate over three contexts' committed rows
 * (`fulfillment_works`, `order_records`, `sync_jobs`), so what makes it correct
 * can only be shown against real Postgres:
 *
 * - a routed work whose `inventory.saleDecrement` job was never enqueued is
 *   selected (the lost-enqueue case the sweep exists for);
 * - a work that has such a job, in ANY status, is not - which is also what keeps
 *   a fully-decremented, skipped or blocked work from ever being re-enqueued, and
 *   why a dead job is left to the operator rather than looped;
 * - a work on a cancelled order, a cancelled work, a work inside the grace
 *   window and a work older than the lookback are not selected - the last is what
 *   keeps a pruned `sync_jobs` row (#2946) from making an old, correctly
 *   decremented work look lost;
 * - enqueueing under the producers' key removes the work from the set.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_SALE_DECREMENT_RECONCILE_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  buildSaleDecrementJobDedupeKey,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentSaleDecrementReconcileService,
} from '@openlinker/core/fulfillment';

import { createTestOrderRecord } from './fixtures/order.fixtures';
import { createTestSyncJob } from './fixtures/sync-job.fixtures';
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

/** Structural view: the repository port is intra-context and off the barrel. */
interface WorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
}

const GRACE_MS = 10 * 60 * 1000;
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const SOURCE = '11111111-1111-4111-8111-111111111111';
const HOLDER = '22222222-2222-4222-8222-222222222222';

describe('Sale-decrement reconcile frontier (#3629)', () => {
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

  const reconcile = (): IFulfillmentSaleDecrementReconcileService =>
    harness
      .getApp()
      .get<IFulfillmentSaleDecrementReconcileService>(
        FULFILLMENT_SALE_DECREMENT_RECONCILE_SERVICE_TOKEN
      );

  /** An order record plus a work routed for it, the work aged `ageMinutes`. */
  const seedRoutedWork = async (
    orderId: string,
    options: { ageMinutes?: number; cancelledOrder?: boolean } = {}
  ): Promise<FulfillmentWork> => {
    await createTestOrderRecord(harness.getDataSource(), {
      internalOrderId: orderId,
      sourceConnectionId: SOURCE,
      cancelledAt: options.cancelledOrder === true ? new Date() : null,
    });
    const work = await repository().create({
      orderId,
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: HOLDER,
      lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: 2 }],
    });
    await harness
      .getDataSource()
      .query(
        `UPDATE "fulfillment_works" SET "createdAt" = now() - ($1 || ' minutes')::interval WHERE "id" = $2`,
        [String(options.ageMinutes ?? 60), work.id]
      );
    return work;
  };

  const list = (limit = 50) =>
    reconcile().listWorksMissingSaleDecrementJob({ limit, graceMs: GRACE_MS, lookbackMs: LOOKBACK_MS, now: new Date() });

  const seedDecrementJob = (workId: string, status: 'queued' | 'succeeded' | 'dead') =>
    createTestSyncJob(harness.getDataSource(), {
      jobType: 'inventory.saleDecrement' as never,
      connectionId: SOURCE,
      status,
      idempotencyKey: buildSaleDecrementJobDedupeKey(workId),
    });

  it('should select a routed work whose decrement job was never enqueued', async () => {
    const work = await seedRoutedWork('ol_order_lost');

    const page = await list();

    expect(page.candidates).toEqual([
      {
        workId: work.id,
        orderId: 'ol_order_lost',
        // The ORDER's source connection (#2609), never the holder.
        connectionId: SOURCE,
        dedupeKey: buildSaleDecrementJobDedupeKey(work.id),
      },
    ]);
  });

  it.each(['queued', 'succeeded', 'dead'] as const)(
    'should not select a work whose decrement job exists as %s',
    async (status) => {
      const work = await seedRoutedWork('ol_order_has_job');
      await seedDecrementJob(work.id, status);

      expect((await list()).candidates).toEqual([]);
    }
  );

  it('should leave the set once the job is enqueued under the producers key', async () => {
    const work = await seedRoutedWork('ol_order_recovered');
    expect((await list()).candidates).toHaveLength(1);

    await seedDecrementJob(work.id, 'queued');

    expect((await list()).candidates).toEqual([]);
  });

  it('should not select a work on a cancelled order', async () => {
    await seedRoutedWork('ol_order_cancelled', { cancelledOrder: true });

    expect((await list()).candidates).toEqual([]);
  });

  it('should not select a work inside the grace window', async () => {
    await seedRoutedWork('ol_order_fresh', { ageMinutes: 1 });

    expect((await list()).candidates).toEqual([]);
  });

  it('should not select a work older than the lookback, whatever its job history', async () => {
    // 8 days: past the 7 day lookback and well inside the 30 day retention, so
    // the test does not depend on the retention value, only on the floor.
    await seedRoutedWork('ol_order_ancient', { ageMinutes: 8 * 24 * 60 });

    expect((await list()).candidates).toEqual([]);
  });

  it('should still select a work just inside the lookback', async () => {
    const work = await seedRoutedWork('ol_order_edge', { ageMinutes: 6 * 24 * 60 });

    expect((await list()).candidates.map((entry) => entry.workId)).toEqual([work.id]);
  });

  it('should return the oldest work first and respect the limit', async () => {
    const newer = await seedRoutedWork('ol_order_newer', { ageMinutes: 30 });
    const older = await seedRoutedWork('ol_order_older', { ageMinutes: 120 });

    const page = await list(1);

    expect(page.candidates.map((entry) => entry.workId)).toEqual([older.id]);
    expect(newer.id).not.toBe(older.id);
  });
});
