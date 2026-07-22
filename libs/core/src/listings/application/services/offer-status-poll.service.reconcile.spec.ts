/**
 * Unit tests for the post-terminal snapshot-reconcile scheduling in
 * OfferStatusPollService (#1760). Covers that a reconcile job is scheduled on
 * the terminal-`draft` and POLL_TIMEOUT paths, and NOT on a validation failure.
 */
import type { ConfigService } from '@nestjs/config';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { ISyncJobsService } from '@openlinker/core/sync';
import type { OfferCreationRecordRepositoryPort } from '../../domain/ports/offer-creation-record-repository.port';
import { OfferStatusPollService } from './offer-status-poll.service';

const REFRESH_JOB_TYPE = 'marketplace.offer.refreshSnapshot';

describe('OfferStatusPollService — snapshot reconcile scheduling (#1760)', () => {
  let integrations: { getCapabilityAdapter: jest.Mock };
  let records: jest.Mocked<
    Pick<OfferCreationRecordRepositoryPort, 'findById' | 'updateStatus' | 'updateClassificationReport'>
  >;
  let syncJobs: jest.Mocked<Pick<ISyncJobsService, 'schedule'>>;
  let service: OfferStatusPollService;

  const input = {
    offerCreationRecordId: 'rec-1',
    externalOfferId: '7781896308',
    connectionId: 'conn-1',
    pollAttempt: 1,
  };

  const validatingRecord = {
    id: 'rec-1',
    status: 'validating',
    internalVariantId: 'ol_variant_1',
    connectionId: 'conn-1',
  };

  beforeEach(() => {
    integrations = { getCapabilityAdapter: jest.fn() };
    records = {
      findById: jest.fn().mockResolvedValue(validatingRecord),
      updateStatus: jest.fn().mockResolvedValue(undefined),
      updateClassificationReport: jest.fn().mockResolvedValue(undefined),
    };
    syncJobs = { schedule: jest.fn().mockResolvedValue(undefined as never) };
    const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    service = new OfferStatusPollService(
      integrations as unknown as IIntegrationsService,
      records as unknown as OfferCreationRecordRepositoryPort,
      syncJobs as unknown as ISyncJobsService,
      config
    );
  });

  function scheduledRefreshCalls(): unknown[] {
    return syncJobs.schedule.mock.calls.filter(
      ([arg]) => (arg as { jobType: string }).jobType === REFRESH_JOB_TYPE
    );
  }

  it('should schedule a snapshot reconcile when the offer lands as a clean draft', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      getOfferStatus: jest.fn().mockResolvedValue({ publicationStatus: 'inactive', validationErrors: [] }),
    });

    const result = await service.pollOnce(input);

    expect(result.outcome).toBe('ok');
    expect(records.updateStatus).toHaveBeenCalledWith('rec-1', 'draft', null);
    const calls = scheduledRefreshCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0] as [{ payload: { internalVariantId: string; attempt: number } }])[0].payload).toEqual(
      expect.objectContaining({ internalVariantId: 'ol_variant_1', attempt: 1 })
    );
  });

  it('should NOT schedule a reconcile when the offer fails validation', async () => {
    integrations.getCapabilityAdapter.mockResolvedValue({
      getOfferStatus: jest.fn().mockResolvedValue({
        publicationStatus: 'inactive',
        validationErrors: [{ code: 'X', message: 'bad', field: null }],
      }),
    });

    const result = await service.pollOnce(input);

    expect(result.outcome).toBe('business_failure');
    expect(scheduledRefreshCalls()).toHaveLength(0);
  });

  it('should schedule a reconcile on POLL_TIMEOUT (attempt over the cap)', async () => {
    const result = await service.pollOnce({ ...input, pollAttempt: 13 });

    expect(result.outcome).toBe('business_failure');
    expect(integrations.getCapabilityAdapter).not.toHaveBeenCalled();
    expect(scheduledRefreshCalls()).toHaveLength(1);
  });
});
