/**
 * Orders Holds Reconcile Handler — unit tests (#2340)
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import type { ConfigService } from '@nestjs/config';
import type { SyncJob, SyncLockPort } from '@openlinker/core/sync';
import type { IOrderHoldProjectionReconcileService } from '@openlinker/core/orders';
import { OrdersHoldsReconcileHandler } from '../orders-holds-reconcile.handler';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const LOCK_KEY = `orders:holds:reconcile:${SYSTEM_ID}`;

function job(overrides: Partial<SyncJob> = {}): SyncJob {
  return {
    id: 'job-1',
    jobType: 'orders.holds.reconcile',
    connectionId: SYSTEM_ID,
    payload: { schemaVersion: 1 },
    ...overrides,
  } as unknown as SyncJob;
}

describe('OrdersHoldsReconcileHandler', () => {
  let reconcile: jest.Mocked<IOrderHoldProjectionReconcileService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let handler: OrdersHoldsReconcileHandler;

  beforeEach(() => {
    reconcile = {
      runPage: jest
        .fn()
        .mockResolvedValue({ examined: 0, repaired: 0, superseded: 0, failed: 0 }),
    } as unknown as jest.Mocked<IOrderHoldProjectionReconcileService>;
    syncLock = {
      acquire: jest.fn().mockResolvedValue('token'),
      release: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<SyncLockPort>;
    handler = new OrdersHoldsReconcileHandler(reconcile, syncLock, {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);
  });

  it('should repair one bounded page under the pass-specific lock', async () => {
    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });

    expect(syncLock.acquire).toHaveBeenCalledWith(LOCK_KEY, expect.any(Number));
    expect(reconcile.runPage).toHaveBeenCalledWith(500);
    expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'token');
  });

  it('should skip without running when the lock is held', async () => {
    syncLock.acquire.mockResolvedValue(null);

    await expect(handler.execute(job())).resolves.toEqual({ outcome: 'ok' });
    expect(reconcile.runPage).not.toHaveBeenCalled();
  });

  it('should clamp a payload page limit to the sweep-family ceiling', async () => {
    await handler.execute(job({ payload: { schemaVersion: 1, pageLimit: 100_000 } }));
    expect(reconcile.runPage).toHaveBeenCalledWith(500);
  });

  it('should release the lock when the pass throws', async () => {
    reconcile.runPage.mockRejectedValue(new Error('db down'));

    await expect(handler.execute(job())).rejects.toThrow('orders.holds.reconcile failed');
    expect(syncLock.release).toHaveBeenCalledWith(LOCK_KEY, 'token');
  });

  it('should never latch off — a clean page leaves no completion state behind', async () => {
    // Unlike #2317's one-shot backfill: divergence can reappear at any time, so
    // there is no completion stamp to read and no early return to take.
    await handler.execute(job());
    await handler.execute(job());

    expect(reconcile.runPage).toHaveBeenCalledTimes(2);
  });
});
