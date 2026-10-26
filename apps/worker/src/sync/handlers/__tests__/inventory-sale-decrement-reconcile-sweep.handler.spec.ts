/**
 * InventorySaleDecrementReconcileSweepHandler - unit spec (#3629)
 *
 * The acceptance criteria at the seam that composes them: a routed work whose
 * decrement job was never enqueued is picked up and enqueued under the producers'
 * own key; the sweep holds its own lock; a per-candidate failure does not abort
 * the page; and a starved page is surfaced.
 *
 * "A work that already has a decrement job is never re-enqueued" is a property of
 * the frontier query (`NOT EXISTS` over `sync_jobs`), proved against real
 * Postgres in `fulfillment-sale-decrement-reconcile.int-spec.ts`; here the handler
 * additionally proves it enqueues under the SAME key, and that a deduplicated
 * enqueue (a stale dedup key with no job row) is warned and counted as starvation.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { SyncJob } from '@openlinker/core/sync';

import {
  INVENTORY_SALE_DECREMENT_RECONCILE_PAGE_LIMIT_DEFAULT,
  InventorySaleDecrementReconcileSweepHandler,
  inventorySaleDecrementReconcileLockKey,
} from '../inventory-sale-decrement-reconcile-sweep.handler';

const SYSTEM = '00000000-0000-0000-0000-000000000000';

function candidate(workId: string) {
  return {
    workId,
    orderId: `order-for-${workId}`,
    connectionId: `source-of-${workId}`,
    dedupeKey: `inventory:sale-decrement:${workId}`,
  };
}

describe('InventorySaleDecrementReconcileSweepHandler (#3629)', () => {
  let reconcile: { listWorksMissingSaleDecrementJob: jest.Mock };
  let jobEnqueue: { enqueueJob: jest.Mock };
  let syncLock: { acquire: jest.Mock; release: jest.Mock };
  let configService: { get: jest.Mock };
  let handler: InventorySaleDecrementReconcileSweepHandler;
  let errors: string[];

  const job = (payload: Record<string, unknown> | null = { schemaVersion: 1 }): SyncJob =>
    ({
      id: 'job-1',
      jobType: 'inventory.saleDecrement.reconcileSweep' as unknown as SyncJob['jobType'],
      connectionId: SYSTEM,
      payload,
    }) as unknown as SyncJob;

  beforeEach(() => {
    reconcile = {
      listWorksMissingSaleDecrementJob: jest.fn().mockResolvedValue({ candidates: [] }),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j', isExisting: false }) };
    syncLock = { acquire: jest.fn().mockResolvedValue('token'), release: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };

    handler = new InventorySaleDecrementReconcileSweepHandler(
      reconcile as never,
      jobEnqueue as never,
      syncLock as never,
      configService as never
    );

    errors = [];
    jest
      .spyOn(handler['logger'], 'error')
      .mockImplementation((message: unknown) => void errors.push(String(message)));
    jest.spyOn(handler['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(handler['logger'], 'log').mockImplementation(() => undefined);
  });

  it('should enqueue the decrement for a work whose job was lost, under the producers key', async () => {
    reconcile.listWorksMissingSaleDecrementJob.mockResolvedValue({
      candidates: [candidate('w-1')],
    });

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    // The job carries the ORDER's source connection (#2609), never the system id.
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
      jobType: 'inventory.saleDecrement',
      connectionId: 'source-of-w-1',
      payload: { schemaVersion: 1, orderId: 'order-for-w-1', workId: 'w-1' },
      idempotencyKey: 'inventory:sale-decrement:w-1',
    });
  });

  it('should do nothing when no work is missing its job', async () => {
    await handler.execute(job());

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
  });

  it('should warn about a deduplicated enqueue, because the frontier has no job row', async () => {
    reconcile.listWorksMissingSaleDecrementJob.mockResolvedValue({
      candidates: [candidate('w-1'), candidate('w-2')],
    });
    jobEnqueue.enqueueJob
      .mockResolvedValueOnce({ jobId: 'j', isExisting: true })
      .mockResolvedValueOnce({ jobId: 'j', isExisting: false });

    await handler.execute(job());

    const warn = handler['logger'].warn as jest.Mock;
    expect(
      warn.mock.calls.some(
        ([m]) =>
          String(m).includes('sale_decrement_reconcile_stuck_dedup_key') &&
          String(m).includes('w-1')
      )
    ).toBe(true);
    // One candidate was enqueued, so the page is not starved.
    expect(errors).toEqual([]);
  });

  it('should surface a page in which every candidate is hidden behind a stale dedup key', async () => {
    reconcile.listWorksMissingSaleDecrementJob.mockResolvedValue({
      candidates: [candidate('w-1'), candidate('w-2')],
    });
    jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'j', isExisting: true });

    await handler.execute(job());

    expect(errors.some((line) => line.includes('sale_decrement_reconcile_page_all_failed'))).toBe(
      true
    );
  });

  it('should skip a run whose lock is held by a peer', async () => {
    syncLock.acquire.mockResolvedValue(null);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(reconcile.listWorksMissingSaleDecrementJob).not.toHaveBeenCalled();
    expect(syncLock.release).not.toHaveBeenCalled();
    expect(syncLock.acquire).toHaveBeenCalledWith(
      inventorySaleDecrementReconcileLockKey(SYSTEM),
      expect.any(Number)
    );
  });

  it('should release its lock after a run', async () => {
    await handler.execute(job());

    expect(syncLock.release).toHaveBeenCalledWith(
      inventorySaleDecrementReconcileLockKey(SYSTEM),
      'token'
    );
  });

  it('should keep enqueueing the rest of the page when one candidate fails', async () => {
    reconcile.listWorksMissingSaleDecrementJob.mockResolvedValue({
      candidates: [candidate('w-1'), candidate('w-2')],
    });
    jobEnqueue.enqueueJob
      .mockRejectedValueOnce(new Error('postgres hiccup'))
      .mockResolvedValueOnce({ jobId: 'j', isExisting: false });

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
    expect(errors.some((line) => line.includes('w-1'))).toBe(true);
    expect(errors.some((line) => line.includes('page_all_failed'))).toBe(false);
  });

  it('should surface a page in which nothing could be enqueued', async () => {
    reconcile.listWorksMissingSaleDecrementJob.mockResolvedValue({
      candidates: [candidate('w-1'), candidate('w-2')],
    });
    jobEnqueue.enqueueJob.mockRejectedValue(new Error('postgres down'));

    await handler.execute(job());

    expect(errors.some((line) => line.includes('sale_decrement_reconcile_page_all_failed'))).toBe(
      true
    );
  });

  it('should fail the job, and still release its lock, when the frontier read throws', async () => {
    reconcile.listWorksMissingSaleDecrementJob.mockRejectedValue(new Error('read failed'));

    await expect(handler.execute(job())).rejects.toThrow(
      'inventory.saleDecrement.reconcileSweep failed'
    );
    expect(syncLock.release).toHaveBeenCalled();
  });

  it('should use the derived default budget and honour a payload override within the ceiling', async () => {
    await handler.execute(job());
    expect(reconcile.listWorksMissingSaleDecrementJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: INVENTORY_SALE_DECREMENT_RECONCILE_PAGE_LIMIT_DEFAULT })
    );

    await handler.execute(job({ schemaVersion: 1, pageLimit: 120 }));
    expect(reconcile.listWorksMissingSaleDecrementJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 120 })
    );
  });

  it('should pass the default lookback and honour the environment override (#3629)', async () => {
    await handler.execute(job());
    expect(reconcile.listWorksMissingSaleDecrementJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ lookbackMs: 10 * 24 * 60 * 60 * 1000 })
    );

    configService.get.mockImplementation((key: string) =>
      key === 'OL_SALE_DECREMENT_RECONCILE_LOOKBACK_MS'
        ? String(2 * 24 * 60 * 60 * 1000)
        : undefined
    );
    await handler.execute(job());
    expect(reconcile.listWorksMissingSaleDecrementJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ lookbackMs: 2 * 24 * 60 * 60 * 1000 })
    );
  });
});
