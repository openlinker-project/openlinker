/**
 * Unit tests for `MarketplaceOfferPauseStaleSweepHandler` (#1689).
 *
 * Mocks `IStaleOfferPauseService`. Pins the payload limit default/fallback,
 * the success delegation path (using `job.connectionId`, not a payload field),
 * and the OL-shaped error wrapping when the service throws.
 *
 * @module apps/worker/src/sync/handlers
 */
import type { IStaleOfferPauseService, StaleOfferPauseResult } from '@openlinker/core/listings';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { MarketplaceOfferPauseStaleSweepHandler } from './marketplace-offer-pause-stale-sweep.handler';

function makeJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'marketplace.offer.pauseStaleSweep',
    connectionId: 'conn-1',
    payload,
    idempotencyKey: 'marketplace:conn-1:offer:pauseStaleSweep:123',
    status: 'running',
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

const EMPTY_RESULT: StaleOfferPauseResult = {
  variantsConsidered: 0,
  variantsStillStale: 0,
  offersPaused: 0,
  offersSkipped: 0,
};

describe('MarketplaceOfferPauseStaleSweepHandler', () => {
  let staleOfferPause: jest.Mocked<IStaleOfferPauseService>;
  let handler: MarketplaceOfferPauseStaleSweepHandler;

  beforeEach(() => {
    staleOfferPause = {
      pauseOffersForVariants: jest.fn(),
      sweepConnection: jest.fn().mockResolvedValue(EMPTY_RESULT),
    };
    handler = new MarketplaceOfferPauseStaleSweepHandler(staleOfferPause);
  });

  it('delegates to sweepConnection with job.connectionId and the payload limit', async () => {
    const result = await handler.execute(makeJob({ schemaVersion: 1, limit: 50 }));

    expect(staleOfferPause.sweepConnection).toHaveBeenCalledWith('conn-1', { limit: 50 });
    expect(result).toEqual({ outcome: 'ok' });
  });

  it.each([
    ['undefined payload', undefined],
    ['non-numeric limit', { schemaVersion: 1, limit: 'fifty' }],
    ['zero limit', { schemaVersion: 1, limit: 0 }],
  ])('falls back to the default limit for %s', async (_label, payload) => {
    await handler.execute(makeJob(payload));

    expect(staleOfferPause.sweepConnection).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({ limit: expect.any(Number) })
    );
    expect(staleOfferPause.sweepConnection.mock.calls[0][1].limit).toBeGreaterThan(0);
  });

  it('wraps a service failure in an OL-shaped SyncJobExecutionError', async () => {
    staleOfferPause.sweepConnection.mockRejectedValueOnce(new Error('boom'));

    await expect(
      handler.execute(makeJob({ schemaVersion: 1, limit: 50 }))
    ).rejects.toBeInstanceOf(SyncJobExecutionError);
  });
});
