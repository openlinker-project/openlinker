/**
 * Sync Job Bulk Retry Service Unit Tests
 *
 * Covers the event emission branch (fires only when count > 0) and the
 * BULK_RETRY_MAX_BATCH_SIZE contract at the repository boundary.
 *
 * @module libs/core/src/sync/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SyncJobBulkRetryService } from './sync-job-bulk-retry.service';
import type { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import { SYNC_JOB_REPOSITORY_TOKEN } from '../../sync.tokens';
import type { EventPublisherPort } from '@openlinker/core/events';
import { EVENT_PUBLISHER_TOKEN } from '@openlinker/core/events';
import type { BulkRetryResult } from '../../domain/types/sync-job.types';
import {
  BULK_RETRY_MAX_BATCH_SIZE,
  SYNC_JOBS_EVENT_STREAM,
} from '../../domain/types/sync-job.types';

describe('SyncJobBulkRetryService', () => {
  let service: SyncJobBulkRetryService;
  let mockRepository: jest.Mocked<Pick<SyncJobRepositoryPort, 'requeueDeadJobsInGroup'>>;
  let mockPublisher: jest.Mocked<EventPublisherPort>;

  const connectionId = '11111111-1111-4111-8111-111111111111';
  const jobType = 'master.inventory.syncByExternalId';

  beforeEach(async () => {
    mockRepository = {
      requeueDeadJobsInGroup: jest.fn(),
    };
    mockPublisher = {
      publish: jest.fn().mockResolvedValue('stream-msg-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncJobBulkRetryService,
        { provide: SYNC_JOB_REPOSITORY_TOKEN, useValue: mockRepository },
        { provide: EVENT_PUBLISHER_TOKEN, useValue: mockPublisher },
      ],
    }).compile();

    service = module.get(SyncJobBulkRetryService);
  });

  it('should pass BULK_RETRY_MAX_BATCH_SIZE to the repository', async () => {
    mockRepository.requeueDeadJobsInGroup.mockResolvedValue({
      requeuedJobIds: [],
      count: 0,
      skipped: 0,
    });

    await service.retryGroup(connectionId, jobType);

    expect(mockRepository.requeueDeadJobsInGroup).toHaveBeenCalledWith(
      connectionId,
      jobType,
      BULK_RETRY_MAX_BATCH_SIZE
    );
  });

  it('should emit sync.job.bulk-retry-requested on the sync-jobs stream when count > 0', async () => {
    const repoResult: BulkRetryResult = {
      requeuedJobIds: ['job-1', 'job-2', 'job-3'],
      count: 3,
      skipped: 1,
    };
    mockRepository.requeueDeadJobsInGroup.mockResolvedValue(repoResult);

    const result = await service.retryGroup(connectionId, jobType);

    expect(result).toEqual(repoResult);
    expect(mockPublisher.publish).toHaveBeenCalledTimes(1);
    const [streamName, envelope] = mockPublisher.publish.mock.calls[0];
    expect(streamName).toBe(SYNC_JOBS_EVENT_STREAM);
    expect(envelope.eventType).toBe('sync.job.bulk-retry-requested');
    expect(JSON.parse(envelope.payloadJson)).toEqual({
      connectionId,
      jobType,
      jobIds: ['job-1', 'job-2', 'job-3'],
      count: 3,
      skipped: 1,
    });
    expect(JSON.parse(envelope.metadataJson!)).toEqual({ schemaVersion: '1' });
  });

  it('should not emit an event when count is zero', async () => {
    mockRepository.requeueDeadJobsInGroup.mockResolvedValue({
      requeuedJobIds: [],
      count: 0,
      skipped: 0,
    });

    await service.retryGroup(connectionId, jobType);

    expect(mockPublisher.publish).not.toHaveBeenCalled();
  });

  it('should surface the repository result unchanged', async () => {
    const repoResult: BulkRetryResult = {
      requeuedJobIds: ['only-one'],
      count: 1,
      skipped: 5,
    };
    mockRepository.requeueDeadJobsInGroup.mockResolvedValue(repoResult);

    const result = await service.retryGroup(connectionId, jobType);

    expect(result).toBe(repoResult);
  });
});
