/**
 * Marketplace Offer Poll Creation Status Handler Tests
 *
 * Smoke tests — payload parsing and delegation. The state-machine /
 * cadence policy is exercised in `offer-status-poll.service.spec.ts`.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { SyncJobExecutionError } from '@openlinker/core/sync';
import { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { IOfferStatusPollService } from '@openlinker/core/listings';

import { MarketplaceOfferPollCreationStatusHandler } from '../marketplace-offer-poll-creation-status.handler';

const RECORD_ID = 'record-447';
const EXTERNAL_OFFER_ID = '7781562863';
const CONNECTION_ID = 'conn-allegro';
const JOB_ID = 'job-1';

describe('MarketplaceOfferPollCreationStatusHandler', () => {
  let handler: MarketplaceOfferPollCreationStatusHandler;
  let offerStatusPoll: jest.Mocked<IOfferStatusPollService>;

  beforeEach(() => {
    offerStatusPoll = {
      scheduleFirstPoll: jest.fn(),
      pollOnce: jest.fn(),
    };
    handler = new MarketplaceOfferPollCreationStatusHandler(offerStatusPoll);
  });

  const createJob = (payload: Record<string, unknown>): SyncJob => ({
    id: JOB_ID,
    jobType: 'marketplace.offer.pollCreationStatus' as unknown as SyncJob['jobType'],
    connectionId: CONNECTION_ID,
    payload,
    idempotencyKey: `pollCreationStatus:${RECORD_ID}:1`,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    nextRunAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const validPayload = {
    schemaVersion: 1,
    offerCreationRecordId: RECORD_ID,
    externalOfferId: EXTERNAL_OFFER_ID,
    pollAttempt: 1,
  };

  it('delegates to pollOnce with parsed payload + job connection id', async () => {
    offerStatusPoll.pollOnce.mockResolvedValue({ outcome: 'ok' });

    const result = await handler.execute(createJob(validPayload));

    expect(offerStatusPoll.pollOnce).toHaveBeenCalledWith({
      offerCreationRecordId: RECORD_ID,
      externalOfferId: EXTERNAL_OFFER_ID,
      connectionId: CONNECTION_ID,
      pollAttempt: 1,
    });
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('forwards business_failure outcomes unchanged', async () => {
    offerStatusPoll.pollOnce.mockResolvedValue({ outcome: 'business_failure' });

    const result = await handler.execute(createJob(validPayload));

    expect(result).toEqual({ outcome: 'business_failure' });
  });

  it('wraps service throws as SyncJobExecutionError so the runner schedules retry', async () => {
    offerStatusPoll.pollOnce.mockRejectedValue(new Error('ECONNRESET'));

    await expect(handler.execute(createJob(validPayload))).rejects.toThrow(SyncJobExecutionError);
  });

  it.each([
    [{ ...validPayload, schemaVersion: 2 }, 'Unsupported schemaVersion'],
    [{ ...validPayload, offerCreationRecordId: '' }, 'offerCreationRecordId'],
    [{ ...validPayload, externalOfferId: undefined }, 'externalOfferId'],
    [{ ...validPayload, pollAttempt: 0 }, 'pollAttempt'],
    [{ ...validPayload, pollAttempt: 1.5 }, 'pollAttempt'],
  ])('rejects malformed payload (%p)', async (badPayload, msgFragment) => {
    await expect(handler.execute(createJob(badPayload as Record<string, unknown>))).rejects.toThrow(
      msgFragment,
    );
    expect(offerStatusPoll.pollOnce).not.toHaveBeenCalled();
  });
});
