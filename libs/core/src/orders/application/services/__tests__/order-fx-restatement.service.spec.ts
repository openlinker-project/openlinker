/**
 * Order FX Restatement Service Tests (#2468)
 *
 * @module libs/core/src/orders/application/services
 */
import type { JobEnqueuePort } from '@openlinker/core/sync';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import type { SalesAnalyticsFilters } from '../../../domain/types/order-sales-analytics.types';
import { OrderFxRestatementService } from '../order-fx-restatement.service';

const SCOPE: SalesAnalyticsFilters = {
  from: new Date('2026-08-01T00:00:00Z'),
  to: new Date('2026-08-27T00:00:00Z'),
};

describe('OrderFxRestatementService', () => {
  let repository: jest.Mocked<
    Pick<
      OrderRecordRepositoryPort,
      | 'findCurrencyMismatchOrderRefsAfter'
      | 'clearFxStampForRestatement'
      | 'countRemainingCurrencyMismatch'
    >
  >;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let service: OrderFxRestatementService;

  beforeEach(() => {
    repository = {
      findCurrencyMismatchOrderRefsAfter: jest.fn().mockResolvedValue([]),
      clearFxStampForRestatement: jest.fn().mockResolvedValue(true),
      countRemainingCurrencyMismatch: jest
        .fn()
        .mockResolvedValue({ total: 0, terminalMarked: 0, pending: 0 }),
    };
    jobEnqueue = { enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }) };
    service = new OrderFxRestatementService(
      repository as unknown as OrderRecordRepositoryPort,
      jobEnqueue
    );
  });

  function seed(ids: string[]): void {
    repository.findCurrencyMismatchOrderRefsAfter.mockResolvedValue(
      ids.map((internalOrderId) => ({ internalOrderId, sourceConnectionId: 'conn-1' }))
    );
  }

  it('should clear an order stamp BEFORE enqueuing its stamp job', async () => {
    // Reversed, the stamp job can legitimately run first, find the stale figure
    // still present, and no-op via `stamp()`'s already-stamped short-circuit —
    // which is exactly the original live-demo bug ("we re-enqueued and nothing
    // changed").
    const order: string[] = [];
    repository.clearFxStampForRestatement.mockImplementation(() => {
      order.push('clear');
      return Promise.resolve(true);
    });
    jobEnqueue.enqueueJob.mockImplementation(() => {
      order.push('enqueue');
      return Promise.resolve({ jobId: 'job-1', isExisting: false });
    });
    seed(['ol_order_a']);

    await service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 });

    expect(order).toEqual(['clear', 'enqueue']);
  });

  it('should enqueue under a run-scoped idempotency key, never the TTL-less bare fx:{orderId}', async () => {
    // `OrderFxStampService.enqueueRetry` already spent `fx:{orderId}` for any
    // order that ever degraded to a retry, and `sync_jobs.idempotencyKey` is
    // globally unique with no TTL — reusing it would silently enqueue nothing.
    seed(['ol_order_a']);

    await service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 });

    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'marketplace.order.fxStamp',
        connectionId: 'conn-1',
        idempotencyKey: 'fx:restate:run-1:ol_order_a',
        payload: { schemaVersion: 1, internalOrderId: 'ol_order_a' },
      })
    );
  });

  it("should file each child job under the order's own source connection", async () => {
    repository.findCurrencyMismatchOrderRefsAfter.mockResolvedValue([
      { internalOrderId: 'ol_order_a', sourceConnectionId: 'conn-a' },
      { internalOrderId: 'ol_order_b', sourceConnectionId: 'conn-b' },
    ]);

    await service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 });

    expect(jobEnqueue.enqueueJob.mock.calls.map(([req]) => req.connectionId)).toEqual([
      'conn-a',
      'conn-b',
    ]);
  });

  it('should return the last id as the cursor on a full page and null on a short one', async () => {
    seed(['ol_order_a', 'ol_order_b']);
    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 2 })
    ).resolves.toMatchObject({ scanned: 2, nextCursor: 'ol_order_b' });

    seed(['ol_order_c']);
    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: 'ol_order_b', limit: 2 })
    ).resolves.toMatchObject({ scanned: 1, nextCursor: null });
  });

  it('should pass the keyset lower bound through so the enumeration can never re-read a cleared page', async () => {
    seed([]);

    await service.restatePage(SCOPE, 'EUR', {
      runId: 'run-1',
      afterOrderId: 'ol_order_b',
      limit: 5,
    });

    expect(repository.findCurrencyMismatchOrderRefsAfter).toHaveBeenCalledWith(SCOPE, 'EUR', {
      afterOrderId: 'ol_order_b',
      limit: 5,
    });
  });

  it('should not count a never-stamped order as cleared, but still enqueue it', async () => {
    // A never-stamped order is in the mismatch population too; the guarded
    // clear reports false for it and only the enqueue matters.
    repository.clearFxStampForRestatement.mockResolvedValue(false);
    seed(['ol_order_a']);

    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 })
    ).resolves.toMatchObject({ cleared: 0, enqueued: 1 });
  });

  it('should keep going when one order fails to clear, so a single bad row cannot abort the repair', async () => {
    repository.clearFxStampForRestatement
      .mockRejectedValueOnce(new Error('deadlock detected'))
      .mockResolvedValue(true);
    seed(['ol_order_a', 'ol_order_b']);

    const result = await service.restatePage(SCOPE, 'EUR', {
      runId: 'run-1',
      afterOrderId: null,
      limit: 10,
    });

    expect(result).toMatchObject({ scanned: 2, cleared: 1 });
  });

  it('should keep going when one enqueue fails, leaving the hourly sweep as that order’s route', async () => {
    jobEnqueue.enqueueJob
      .mockRejectedValueOnce(new Error('redis down'))
      .mockResolvedValue({ jobId: 'job-2', isExisting: false });
    seed(['ol_order_a', 'ol_order_b']);

    await expect(
      service.restatePage(SCOPE, 'EUR', { runId: 'run-1', afterOrderId: null, limit: 10 })
    ).resolves.toMatchObject({ scanned: 2, enqueued: 1 });
  });

  it('should delegate the remaining-population read straight through', async () => {
    repository.countRemainingCurrencyMismatch.mockResolvedValue({
      total: 3,
      terminalMarked: 2,
      pending: 1,
    });

    await expect(service.countRemaining(SCOPE, 'EUR')).resolves.toEqual({
      total: 3,
      terminalMarked: 2,
      pending: 1,
    });
  });
});
