/**
 * OrdersImportHandler tests (#4228)
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { OrderSyncStartUnavailableError } from '@openlinker/core/orders';
import type { IOrderIngestionService } from '@openlinker/core/orders';
import { ContendedWriteError, SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { OrdersImportHandler } from '../orders-import.handler';

function makeJob(payload: Record<string, unknown>): SyncJob {
  return {
    id: 'job-1',
    jobType: 'marketplace.orders.import',
    connectionId: 'conn-1',
    payload,
  } as unknown as SyncJob;
}

const validPayload = {
  schemaVersion: 1,
  runId: 'run-1',
  from: '2026-10-01',
  direction: 'newest-first',
  cursor: null,
  page: 1,
};

describe('OrdersImportHandler', () => {
  let importOrderWindow: jest.Mock;
  let handler: OrdersImportHandler;

  beforeEach(() => {
    importOrderWindow = jest.fn();
    handler = new OrdersImportHandler({ importOrderWindow } as unknown as IOrderIngestionService);
  });

  it('should delegate one page to core and succeed', async () => {
    importOrderWindow.mockResolvedValue({ fetched: 3, enqueued: 3, done: false, skippedDueToLock: false });

    await expect(handler.execute(makeJob(validPayload))).resolves.toEqual({ outcome: 'ok' });
    expect(importOrderWindow).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ runId: 'run-1', direction: 'newest-first', page: 1, cursor: null })
    );
  });

  it('should defer penalty-free rather than succeed when another page holds the lock, so the chain is not dropped', async () => {
    importOrderWindow.mockResolvedValue({ fetched: 0, enqueued: 0, done: false, skippedDueToLock: true });

    const failure = await handler.execute(makeJob(validPayload)).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ContendedWriteError);
    expect(failure).not.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should end as a business failure when the adapter cannot read a window', async () => {
    importOrderWindow.mockRejectedValue(new OrderSyncStartUnavailableError('no window'));

    await expect(handler.execute(makeJob(validPayload))).resolves.toEqual({
      outcome: 'business_failure',
    });
  });

  it('should retry on any other failure', async () => {
    importOrderWindow.mockRejectedValue(new Error('shop down'));

    await expect(handler.execute(makeJob(validPayload))).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('should reject a payload without a run id or direction', async () => {
    await expect(handler.execute(makeJob({ schemaVersion: 1, page: 1 }))).rejects.toBeInstanceOf(
      SyncJobExecutionError
    );
    expect(importOrderWindow).not.toHaveBeenCalled();
  });
});
