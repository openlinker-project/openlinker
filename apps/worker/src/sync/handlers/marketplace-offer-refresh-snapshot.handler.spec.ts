/**
 * Unit tests for MarketplaceOfferRefreshSnapshotHandler (#1760).
 */
import type { IOfferStatusSyncService } from '@openlinker/core/listings';
import type { ISyncJobsService, SyncJob } from '@openlinker/core/sync';
import { MarketplaceOfferRefreshSnapshotHandler } from './marketplace-offer-refresh-snapshot.handler';

function makeJob(attempt: number): SyncJob {
  return {
    id: 'job-1',
    connectionId: 'conn-1',
    jobType: 'marketplace.offer.refreshSnapshot',
    payload: {
      schemaVersion: 1,
      externalOfferId: '7781896308',
      internalVariantId: 'ol_variant_1',
      attempt,
    },
  } as unknown as SyncJob;
}

describe('MarketplaceOfferRefreshSnapshotHandler', () => {
  let offerStatusSync: jest.Mocked<Pick<IOfferStatusSyncService, 'refreshOne'>>;
  let syncJobs: jest.Mocked<Pick<ISyncJobsService, 'schedule'>>;
  let handler: MarketplaceOfferRefreshSnapshotHandler;

  beforeEach(() => {
    offerStatusSync = { refreshOne: jest.fn() };
    syncJobs = { schedule: jest.fn().mockResolvedValue(undefined as never) };
    handler = new MarketplaceOfferRefreshSnapshotHandler(
      offerStatusSync as unknown as IOfferStatusSyncService,
      syncJobs as unknown as ISyncJobsService
    );
  });

  it('should not reschedule once the offer is active', async () => {
    offerStatusSync.refreshOne.mockResolvedValue('active');

    const result = await handler.execute(makeJob(1));

    expect(result).toEqual({ outcome: 'ok' });
    expect(syncJobs.schedule).not.toHaveBeenCalled();
  });

  it('should not reschedule when the status is unknown (adapter unsupported / not found)', async () => {
    offerStatusSync.refreshOne.mockResolvedValue(null);

    await handler.execute(makeJob(1));

    expect(syncJobs.schedule).not.toHaveBeenCalled();
  });

  it('should reschedule the next attempt while still inactive and attempts remain', async () => {
    offerStatusSync.refreshOne.mockResolvedValue('inactive');

    await handler.execute(makeJob(1));

    expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
    expect(syncJobs.schedule).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'marketplace.offer.refreshSnapshot',
        idempotencyKey: 'refreshSnapshot:7781896308:2',
        payload: expect.objectContaining({ attempt: 2 }),
      })
    );
  });

  it('should stop rescheduling after the final attempt', async () => {
    offerStatusSync.refreshOne.mockResolvedValue('inactive');

    await handler.execute(makeJob(3));

    expect(syncJobs.schedule).not.toHaveBeenCalled();
  });
});
