/**
 * Sync Job Bulk Retry Service Unit Tests
 *
 * Covers the BULK_RETRY_MAX_BATCH_SIZE contract at the repository boundary and
 * asserts that no event is published: `events.sync.jobs` was a write-only stream
 * with no consumer and was removed in #2163.
 *
 * @module libs/core/src/sync/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SyncJobBulkRetryService } from './sync-job-bulk-retry.service';
import type { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import { SYNC_JOB_REPOSITORY_TOKEN } from '../../sync.tokens';
import type { BulkRetryResult } from '../../domain/types/sync-job.types';
import { BULK_RETRY_MAX_BATCH_SIZE } from '../../domain/types/sync-job.types';

describe('SyncJobBulkRetryService', () => {
  let service: SyncJobBulkRetryService;
  let mockRepository: jest.Mocked<Pick<SyncJobRepositoryPort, 'requeueDeadJobsInGroup'>>;

  const connectionId = '11111111-1111-4111-8111-111111111111';
  const jobType = 'master.inventory.syncByExternalId';

  beforeEach(async () => {
    mockRepository = {
      requeueDeadJobsInGroup: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncJobBulkRetryService,
        { provide: SYNC_JOB_REPOSITORY_TOKEN, useValue: mockRepository },
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

  it('should return the repository result without publishing an event', async () => {
    // `events.sync.jobs` had a publisher and never a consumer, so the event
    // announced work that had already completed synchronously to nobody (#2163).
    const repoResult: BulkRetryResult = {
      requeuedJobIds: ['job-1', 'job-2', 'job-3'],
      count: 3,
      skipped: 1,
    };
    mockRepository.requeueDeadJobsInGroup.mockResolvedValue(repoResult);

    const result = await service.retryGroup(connectionId, jobType);

    expect(result).toEqual(repoResult);
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
