/**
 * Offer Status Poll Service Tests
 *
 * Covers the §5.1 mapping table, re-enqueue cadence, max-attempts cutoff,
 * exception mapping, and terminal-state no-op for the offer-creation poller
 * (#447). The Allegro adapter contract is exercised separately in
 * `allegro-offer-manager.adapter.spec.ts`.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import type { ConfigService } from '@nestjs/config';

import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { OfferManagerPort, OfferStatusReadResult } from '@openlinker/core/listings';
import { OfferNotFoundOnMarketplaceException } from '@openlinker/core/listings';
import type { PollOnceInput } from '../../types/offer-status-poll.types';
import type { ISyncJobsService } from '@openlinker/core/sync';

import { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import type { OfferCreationRecordRepositoryPort } from '../../../domain/ports/offer-creation-record-repository.port';
import { OfferStatusPollService } from '../offer-status-poll.service';

const RECORD_ID = 'record-447';
const EXTERNAL_OFFER_ID = '7781562863';
const CONNECTION_ID = 'conn-allegro-1';

function makeRecord(
  status: 'validating' | 'active' | 'draft' | 'failed' | 'pending',
): OfferCreationRecord {
  return new OfferCreationRecord(
    RECORD_ID,
    'ol_variant_x',
    CONNECTION_ID,
    EXTERNAL_OFFER_ID,
    status,
    null,
    false,
    new Date('2026-05-01T12:00:00Z'),
    new Date('2026-05-01T12:00:00Z'),
  );
}

function statusReader(result: OfferStatusReadResult | (() => never)): OfferManagerPort {
  return {
    updateOfferQuantity: jest.fn(),
    getOfferStatus:
      typeof result === 'function' ? jest.fn(result) : jest.fn().mockResolvedValue(result),
  } as unknown as OfferManagerPort;
}

describe('OfferStatusPollService', () => {
  let service: OfferStatusPollService;
  let integrations: jest.Mocked<IIntegrationsService>;
  let records: jest.Mocked<OfferCreationRecordRepositoryPort>;
  // Only the products-of-sync method the SUT actually calls — tight Pick<>
  // mock surface per #718 review.
  let syncJobs: jest.Mocked<Pick<ISyncJobsService, 'schedule'>>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(() => {
    integrations = {
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      getAdapter: jest.fn(),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    records = {
      create: jest.fn(),
      findById: jest.fn().mockResolvedValue(makeRecord('validating')),
      findLatestByVariantAndConnection: jest.fn(),
      findByExternalOfferIdAndConnectionId: jest.fn(),
      updateStatus: jest.fn().mockImplementation(() => Promise.resolve(makeRecord('active'))),
      updateExternalOfferId: jest.fn(),
      updateExternalIdAndStatus: jest.fn(),
    };

    syncJobs = {
      schedule: jest.fn().mockResolvedValue({}),
    };

    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        switch (key) {
          case 'OL_ALLEGRO_OFFER_POLL_INITIAL_DELAY_SECONDS':
            return 5;
          case 'OL_ALLEGRO_OFFER_POLL_BACKOFF_MULTIPLIER':
            return 2;
          case 'OL_ALLEGRO_OFFER_POLL_MAX_DELAY_SECONDS':
            return 60;
          case 'OL_ALLEGRO_OFFER_POLL_MAX_ATTEMPTS':
            return 12;
          default:
            return undefined;
        }
      }),
    } as unknown as jest.Mocked<ConfigService>;

    service = new OfferStatusPollService(
      integrations,
      records,
      syncJobs as unknown as ISyncJobsService,
      configService
    );
  });

  describe('scheduleFirstPoll', () => {
    it('enqueues iteration #1 with the initial-delay nextRunAt and the right idempotency key', async () => {
      const before = Date.now();

      await service.scheduleFirstPoll({
        offerCreationRecordId: RECORD_ID,
        externalOfferId: EXTERNAL_OFFER_ID,
        connectionId: CONNECTION_ID,
      });

      const [input] = syncJobs.schedule.mock.calls[0];
      expect(input).toMatchObject({
        jobType: 'marketplace.offer.pollCreationStatus',
        connectionId: CONNECTION_ID,
        idempotencyKey: `pollCreationStatus:${RECORD_ID}:1`,
        maxAttempts: 3,
      });
      expect(input.payload).toEqual({
        schemaVersion: 1,
        offerCreationRecordId: RECORD_ID,
        externalOfferId: EXTERNAL_OFFER_ID,
        pollAttempt: 1,
      });
      expect(input.runAfter).toBeInstanceOf(Date);
      const delayMs = input.runAfter.getTime() - before;
      // Initial delay = 5s; allow some slack for test scheduling.
      expect(delayMs).toBeGreaterThanOrEqual(4_900);
      expect(delayMs).toBeLessThanOrEqual(5_500);
    });
  });

  describe('pollOnce — terminal mapping (§5.1)', () => {
    function pollInput(pollAttempt = 1): PollOnceInput {
      return {
        offerCreationRecordId: RECORD_ID,
        externalOfferId: EXTERNAL_OFFER_ID,
        connectionId: CONNECTION_ID,
        pollAttempt,
      };
    }

    it('ACTIVE → record.status=active, outcome=ok, no re-enqueue', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader({ publicationStatus: 'active', validationErrors: [] }),
      );

      const result = await service.pollOnce(pollInput());

      expect(result.outcome).toBe('ok');
      expect(records.updateStatus).toHaveBeenCalledWith(RECORD_ID, 'active', null);
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('ACTIVATING → no record write, re-enqueues iteration 2 with backoff', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader({ publicationStatus: 'activating', validationErrors: [] }),
      );
      const before = Date.now();

      const result = await service.pollOnce(pollInput(1));

      expect(result.outcome).toBe('ok');
      expect(records.updateStatus).not.toHaveBeenCalled();
      const [input] = syncJobs.schedule.mock.calls[0];
      expect(input.idempotencyKey).toBe(`pollCreationStatus:${RECORD_ID}:2`);
      expect((input.payload as { pollAttempt: number }).pollAttempt).toBe(2);
      // Iteration 2 delay = 5 * 2 = 10s
      const delayMs = input.runAfter.getTime() - before;
      expect(delayMs).toBeGreaterThanOrEqual(9_500);
      expect(delayMs).toBeLessThanOrEqual(10_500);
    });

    it('INACTIVATING → re-enqueues (same as ACTIVATING)', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader({ publicationStatus: 'inactivating', validationErrors: [] }),
      );

      const result = await service.pollOnce(pollInput(1));

      expect(result.outcome).toBe('ok');
      expect(records.updateStatus).not.toHaveBeenCalled();
      expect(syncJobs.schedule).toHaveBeenCalledTimes(1);
    });

    it('INACTIVE without errors → record.status=draft, outcome=ok', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader({ publicationStatus: 'inactive', validationErrors: [] }),
      );

      const result = await service.pollOnce(pollInput());

      expect(result.outcome).toBe('ok');
      expect(records.updateStatus).toHaveBeenCalledWith(RECORD_ID, 'draft', null);
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('INACTIVE with errors → record.status=failed (with errors), outcome=business_failure', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader({
          publicationStatus: 'inactive',
          validationErrors: [
            { code: 'TOO_LONG', message: 'name is too long', field: 'name' },
            { code: 'MISSING', message: 'EAN required', field: undefined },
          ],
        }),
      );

      const result = await service.pollOnce(pollInput());

      expect(result.outcome).toBe('business_failure');
      const [recordId, status, errors] = records.updateStatus.mock.calls[0];
      expect(recordId).toBe(RECORD_ID);
      expect(status).toBe('failed');
      expect(errors).toEqual([
        { code: 'TOO_LONG', message: 'name is too long', field: 'name' },
        { code: 'MISSING', message: 'EAN required', field: undefined },
      ]);
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('ENDED → record.status=draft, outcome=ok', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader({ publicationStatus: 'ended', validationErrors: [] }),
      );

      const result = await service.pollOnce(pollInput());

      expect(result.outcome).toBe('ok');
      expect(records.updateStatus).toHaveBeenCalledWith(RECORD_ID, 'draft', null);
    });
  });

  describe('pollOnce — exception paths', () => {
    function pollInput(pollAttempt = 1): PollOnceInput {
      return {
        offerCreationRecordId: RECORD_ID,
        externalOfferId: EXTERNAL_OFFER_ID,
        connectionId: CONNECTION_ID,
        pollAttempt,
      };
    }

    it('OfferNotFoundOnMarketplaceException → record.status=failed, OFFER_NOT_FOUND', async () => {
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => {
          throw new OfferNotFoundOnMarketplaceException(EXTERNAL_OFFER_ID, CONNECTION_ID);
        }),
      );

      const result = await service.pollOnce(pollInput());

      expect(result.outcome).toBe('business_failure');
      const [recordId, status, errors] = records.updateStatus.mock.calls[0];
      expect(recordId).toBe(RECORD_ID);
      expect(status).toBe('failed');
      expect(errors?.[0]).toMatchObject({ code: 'OFFER_NOT_FOUND' });
    });

    it('adapter without OfferStatusReader → record.status=failed, OFFER_POLL_NOT_SUPPORTED', async () => {
      // Adapter has no `getOfferStatus`
      integrations.getCapabilityAdapter.mockResolvedValue({
        updateOfferQuantity: jest.fn(),
      } as unknown as OfferManagerPort);

      const result = await service.pollOnce(pollInput());

      expect(result.outcome).toBe('business_failure');
      const [recordId, status, errors] = records.updateStatus.mock.calls[0];
      expect(recordId).toBe(RECORD_ID);
      expect(status).toBe('failed');
      expect(errors?.[0]).toMatchObject({ code: 'OFFER_POLL_NOT_SUPPORTED' });
    });

    it('transient HTTP error → propagates (runner-level retry handles it)', async () => {
      const httpErr = new Error('ECONNRESET');
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader(() => {
          throw httpErr;
        }),
      );

      await expect(service.pollOnce(pollInput())).rejects.toBe(httpErr);
      expect(records.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('pollOnce — cap & no-op guards', () => {
    function pollInput(pollAttempt = 1): PollOnceInput {
      return {
        offerCreationRecordId: RECORD_ID,
        externalOfferId: EXTERNAL_OFFER_ID,
        connectionId: CONNECTION_ID,
        pollAttempt,
      };
    }

    it('record already at terminal state → no-op + outcome=ok', async () => {
      records.findById.mockResolvedValueOnce(makeRecord('active'));

      const result = await service.pollOnce(pollInput(3));

      expect(result.outcome).toBe('ok');
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(records.updateStatus).not.toHaveBeenCalled();
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('record vanished → drops gracefully + outcome=ok', async () => {
      records.findById.mockResolvedValueOnce(null);

      const result = await service.pollOnce(pollInput(2));

      expect(result.outcome).toBe('ok');
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('next iteration would exceed maxAttempts → marks failed with POLL_TIMEOUT', async () => {
      // Iteration 12 (the cap) sees ACTIVATING — service must NOT re-enqueue
      // iteration 13. Instead it writes POLL_TIMEOUT.
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader({ publicationStatus: 'activating', validationErrors: [] }),
      );

      const result = await service.pollOnce(pollInput(12));

      expect(result.outcome).toBe('ok');
      const [recordId, status, errors] = records.updateStatus.mock.calls[0];
      expect(recordId).toBe(RECORD_ID);
      expect(status).toBe('failed');
      expect(errors?.[0]).toMatchObject({ code: 'POLL_TIMEOUT' });
      expect(syncJobs.schedule).not.toHaveBeenCalled();
    });

    it('pollAttempt > maxAttempts on entry (forward guard) → POLL_TIMEOUT, no marketplace call', async () => {
      // Defensive: payload-level overshoot is treated as terminal without
      // hitting the marketplace.
      const result = await service.pollOnce(pollInput(13));

      expect(result.outcome).toBe('business_failure');
      expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
      expect(records.updateStatus).toHaveBeenCalledWith(
        RECORD_ID,
        'failed',
        [{ code: 'POLL_TIMEOUT', message: expect.stringContaining('POLL_TIMEOUT') }],
      );
    });

    it('cadence caps at maxDelaySeconds for high pollAttempts', async () => {
      // Iteration 5: 5 * 2^4 = 80s, capped to 60s.
      integrations.getCapabilityAdapter.mockResolvedValue(
        statusReader({ publicationStatus: 'activating', validationErrors: [] }),
      );
      const before = Date.now();

      await service.pollOnce(pollInput(5));

      const [input] = syncJobs.schedule.mock.calls[0];
      const delayMs = input.runAfter.getTime() - before;
      // Iteration 6 delay = min(5 * 2^5, 60) = min(160, 60) = 60s
      expect(delayMs).toBeGreaterThanOrEqual(59_500);
      expect(delayMs).toBeLessThanOrEqual(60_500);
    });
  });
});
