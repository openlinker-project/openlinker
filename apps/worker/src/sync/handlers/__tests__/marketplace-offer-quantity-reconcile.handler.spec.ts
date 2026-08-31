/**
 * Marketplace Offer Quantity Reconcile Handler Tests
 *
 * Unit tests for MarketplaceOfferQuantityReconcileHandler (#2621, tech-review
 * follow-up): default/override limit resolution, ok outcome, missing-payload
 * rejection, and error wrapping.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MarketplaceOfferQuantityReconcileHandler } from '../marketplace-offer-quantity-reconcile.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { PendingQuantityAckReconcileResult } from '@openlinker/core/listings';

describe('MarketplaceOfferQuantityReconcileHandler', () => {
  let handler: MarketplaceOfferQuantityReconcileHandler;
  type ReconcileServiceLike = { reconcile: jest.Mock };
  let reconcileService: ReconcileServiceLike;

  const baseResult: PendingQuantityAckReconcileResult = { reconciled: 3, stillPending: 1 };

  beforeEach(() => {
    reconcileService = { reconcile: jest.fn().mockResolvedValue(baseResult) };
    handler = new MarketplaceOfferQuantityReconcileHandler(reconcileService as never);
  });

  const createJob = (payload: unknown): SyncJob => ({
    id: 'job-id',
    jobType: 'marketplace.offerQuantity.reconcile' as unknown as SyncJob['jobType'],
    connectionId: 'connection-1',
    payload: payload as Record<string, unknown>,
    idempotencyKey: 'key',
    status: 'queued',
    attempts: 0,
    maxAttempts: 10,
    nextRunAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  it('passes the payload limit to the service and reports ok', async () => {
    const job = createJob({ schemaVersion: 1, limit: 200 });

    const result = await handler.execute(job);

    expect(reconcileService.reconcile).toHaveBeenCalledWith('connection-1', 200);
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('defaults limit to 100 when the payload limit is missing', async () => {
    const job = createJob({ schemaVersion: 1 });

    await handler.execute(job);

    expect(reconcileService.reconcile).toHaveBeenCalledWith('connection-1', 100);
  });

  it('defaults limit to 100 when the payload limit is not a positive number', async () => {
    const job = createJob({ schemaVersion: 1, limit: -5 });

    await handler.execute(job);

    expect(reconcileService.reconcile).toHaveBeenCalledWith('connection-1', 100);
  });

  it('throws SyncJobExecutionError when the payload is not an object', async () => {
    const job = createJob(null);

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
    expect(reconcileService.reconcile).not.toHaveBeenCalled();
  });

  it('wraps service failures in SyncJobExecutionError', async () => {
    const job = createJob({ schemaVersion: 1, limit: 50 });
    reconcileService.reconcile.mockRejectedValue(new Error('boom'));

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
