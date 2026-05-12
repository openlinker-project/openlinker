/**
 * Marketplace Offers Sync Handler Tests
 *
 * Unit tests for MarketplaceOffersSyncHandler.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { MarketplaceOffersSyncHandler } from '../marketplace-offers-sync.handler';
import { SyncJobExecutionError, ConnectionCursorRepositoryPort } from '@openlinker/core/sync';
import { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { JobEnqueuePort } from '@openlinker/core/sync';

describe('MarketplaceOffersSyncHandler', () => {
  let handler: MarketplaceOffersSyncHandler;
  type OfferMappingSyncServiceLike = { sync: jest.Mock };
  let offerMappingSync: OfferMappingSyncServiceLike;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let cursorRepository: jest.Mocked<ConnectionCursorRepositoryPort>;

  beforeEach(() => {
    offerMappingSync = {
      sync: jest.fn(),
    };

    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    cursorRepository = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ConnectionCursorRepositoryPort>;

    handler = new MarketplaceOffersSyncHandler(
      offerMappingSync,
      jobEnqueue,
      cursorRepository,
    );
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
      feedType: 'offers',
      masterConnectionId: null,
    });
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'marketplace.offers.sync',
        connectionId: 'connection-1',
        idempotencyKey: 'marketplace.offers.sync:offers:connection-1:50',
        payload: expect.objectContaining({
          schemaVersion: 1,
          limit: 50,
          cursor: '50',
          feedType: 'offers',
          masterConnectionId: null,
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

  it('uses cursor repository for events feed', async () => {
    const job = createJob({
      schemaVersion: 1,
      limit: 25,
      cursorKey: 'allegro.offers.lastEventId',
      feedType: 'events',
    });

    cursorRepository.get.mockResolvedValue('event-10');
    offerMappingSync.sync.mockResolvedValue({
      scanned: 1,
      linked: 0,
      skipped: 1,
      nextCursor: 'event-11',
    });

    await handler.execute(job);

    expect(offerMappingSync.sync).toHaveBeenCalledWith('connection-1', {
      limit: 25,
      cursor: 'event-10',
      feedType: 'events',
      masterConnectionId: null,
    });
    expect(cursorRepository.set).toHaveBeenCalledWith(
      'connection-1',
      'allegro.offers.lastEventId',
      'event-11',
    );
    expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey:
          'marketplace.offers.sync:events:connection-1:event-11',
      }),
    );
  });

  it('does not enqueue follow-up when cursor does not advance', async () => {
    const job = createJob({
      schemaVersion: 1,
      limit: 25,
      cursorKey: 'allegro.offers.lastEventId',
      feedType: 'events',
    });

    cursorRepository.get.mockResolvedValue('event-10');
    offerMappingSync.sync.mockResolvedValue({
      scanned: 0,
      linked: 0,
      skipped: 0,
      nextCursor: 'event-10',
    });

    await handler.execute(job);

    expect(cursorRepository.set).not.toHaveBeenCalled();
    expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
  });

  it('throws SyncJobExecutionError on invalid payload', async () => {
    const job = createJob({ schemaVersion: 1 });

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });

  it('throws SyncJobExecutionError when events feed has no cursorKey', async () => {
    const job = createJob({ schemaVersion: 1, limit: 10, feedType: 'events' });

    await expect(handler.execute(job)).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
