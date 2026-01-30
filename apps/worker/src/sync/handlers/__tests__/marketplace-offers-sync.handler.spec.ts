/**
 * Marketplace Offers Sync Handler Tests
 *
 * Unit tests for MarketplaceOffersSyncHandler.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MarketplaceOffersSyncHandler } from '../marketplace-offers-sync.handler';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { JobEnqueuePort } from '@openlinker/core/sync';

describe('MarketplaceOffersSyncHandler', () => {
  let handler: MarketplaceOffersSyncHandler;
  type OfferMappingSyncServiceLike = { sync: jest.Mock };
  let offerMappingSync: OfferMappingSyncServiceLike;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  beforeEach(() => {
    offerMappingSync = {
      sync: jest.fn(),
    };

    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    handler = new MarketplaceOffersSyncHandler(offerMappingSync, jobEnqueue);
  });

  const createJob = (payload: Record<string, unknown>): SyncJob => ({
    id: 'job-id',
    jobType: 'marketplace.offers.sync' as unknown as SyncJob['jobType'],
    connectionId: 'connection-1',
    payload,
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

  it('delegates to OfferMappingSyncService and enqueues follow-up job', async () => {
    const job = createJob({ schemaVersion: 1, limit: 50, cursor: null });

    offerMappingSync.sync.mockResolvedValue({
      scanned: 10,
      linked: 5,
      skipped: 5,
      nextCursor: '50',
    });

    await handler.execute(job);

    expect(offerMappingSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 50,
      cursor: null,
    });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'marketplace.offers.sync',
        connectionId: 'connection-1',
        payload: expect.objectContaining({
          schemaVersion: 1,
          limit: 50,
          cursor: '50',
        }),
      }),
    );
  });

  it('does not enqueue follow-up job when nextCursor is null', async () => {
    const job = createJob({ schemaVersion: 1, limit: 50 });

    offerMappingSync.sync.mockResolvedValue({
      scanned: 10,
      linked: 5,
      skipped: 5,
      nextCursor: null,
    });

    await handler.execute(job);

    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('throws SyncJobExecutionError on invalid payload', async () => {
    const job = createJob({ schemaVersion: 1 });

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
