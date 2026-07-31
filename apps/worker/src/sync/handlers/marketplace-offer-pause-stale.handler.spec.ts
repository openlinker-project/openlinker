/**
 * Unit tests for `MarketplaceOfferPauseStaleHandler` (#1689).
 *
 * Mocks `IStaleOfferPauseService`. Pins the `getPayload` validation branches
 * (missing/invalid payload, empty variantIds, non-string entries, missing
 * correlationId), the success delegation path, and the OL-shaped error
 * wrapping when the service throws.
 *
 * @module apps/worker/src/sync/handlers
 */
import type { IStaleOfferPauseService, StaleOfferPauseResult } from '@openlinker/core/listings';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { SyncJob } from '@openlinker/core/sync';
import { MarketplaceOfferPauseStaleHandler } from './marketplace-offer-pause-stale.handler';

function makeJob(payload: unknown): SyncJob {
  return {
    id: 'job-1',
    jobType: 'marketplace.offer.pauseStale',
    connectionId: '00000000-0000-0000-0000-000000000000',
    payload,
    idempotencyKey: 'stale-pause:ol_product_1:evt-1',
    status: 'running',
    attempts: 1,
    maxAttempts: 10,
    nextRunAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  } as SyncJob;
}

const VALID_PAYLOAD = {
  schemaVersion: 1,
  internalProductId: 'ol_product_1',
  variantIds: ['ol_variant_a', 'ol_variant_b'],
  correlationId: 'corr-1',
};

const RESULT: StaleOfferPauseResult = {
  variantsConsidered: 2,
  variantsStillStale: 2,
  offersPaused: 2,
  offersSkipped: 0,
};

describe('MarketplaceOfferPauseStaleHandler', () => {
  let staleOfferPause: jest.Mocked<IStaleOfferPauseService>;
  let handler: MarketplaceOfferPauseStaleHandler;

  beforeEach(() => {
    staleOfferPause = {
      pauseOffersForVariants: jest.fn().mockResolvedValue(RESULT),
      sweepConnection: jest.fn(),
    };
    handler = new MarketplaceOfferPauseStaleHandler(staleOfferPause);
  });

  describe('getPayload', () => {
    it.each([
      ['undefined payload', undefined],
      ['null payload', null],
      ['non-object payload', 'not-an-object'],
      ['missing internalProductId', { schemaVersion: 1, variantIds: ['a'], correlationId: 'c' }],
      ['missing variantIds', { schemaVersion: 1, internalProductId: 'p', correlationId: 'c' }],
      [
        'empty variantIds',
        { schemaVersion: 1, internalProductId: 'p', variantIds: [], correlationId: 'c' },
      ],
      [
        'non-string entry in variantIds',
        { schemaVersion: 1, internalProductId: 'p', variantIds: ['a', 42], correlationId: 'c' },
      ],
      [
        'missing correlationId',
        { schemaVersion: 1, internalProductId: 'p', variantIds: ['a'] },
      ],
    ])(
      'throws an OL-shaped SyncJobExecutionError and never calls the service for %s',
      async (_label, payload) => {
        await expect(handler.execute(makeJob(payload))).rejects.toBeInstanceOf(
          SyncJobExecutionError
        );
        expect(staleOfferPause.pauseOffersForVariants).not.toHaveBeenCalled();
      }
    );
  });

  it('delegates to pauseOffersForVariants and returns ok on success', async () => {
    const result = await handler.execute(makeJob(VALID_PAYLOAD));

    expect(staleOfferPause.pauseOffersForVariants).toHaveBeenCalledWith({
      variantIds: ['ol_variant_a', 'ol_variant_b'],
      correlationId: 'corr-1',
    });
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('wraps a service failure in an OL-shaped SyncJobExecutionError', async () => {
    staleOfferPause.pauseOffersForVariants.mockRejectedValueOnce(new Error('boom'));

    await expect(handler.execute(makeJob(VALID_PAYLOAD))).rejects.toBeInstanceOf(
      SyncJobExecutionError
    );
  });
});
