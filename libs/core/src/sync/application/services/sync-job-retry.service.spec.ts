/**
 * Sync Job Retry Service Unit Tests
 *
 * @module libs/core/src/sync/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SyncJobRetryService } from './sync-job-retry.service';
import { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import { SYNC_JOB_REPOSITORY_TOKEN } from '../../sync.tokens';
import { SyncJob } from '../../domain/entities/sync-job.entity';
import { InvalidSyncJobStateError } from '../../domain/exceptions/invalid-sync-job-state.error';
import type { JobType, JobStatus } from '../../domain/types/sync-job.types';

interface SyncJobOverrides {
  id?: string;
  jobType?: JobType;
  connectionId?: string;
  payload?: Record<string, unknown>;
  status?: JobStatus;
  idempotencyKey?: string;
  attempts?: number;
  maxAttempts?: number;
  nextRunAt?: Date;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  lastError?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function makeSyncJob(overrides: SyncJobOverrides = {}): SyncJob {
  return new SyncJob(
    overrides.id ?? 'job-1',
    overrides.jobType ?? 'marketplace.order.sync',
    overrides.connectionId ?? 'conn-1',
    overrides.payload ?? {},
    overrides.status ?? 'queued',
    overrides.idempotencyKey ?? 'key-1',
    overrides.attempts ?? 0,
    overrides.maxAttempts ?? 10,
    overrides.nextRunAt ?? new Date(),
    overrides.lockedAt ?? null,
    overrides.lockedBy ?? null,
    overrides.lastError ?? null,
    overrides.createdAt ?? new Date(),
    overrides.updatedAt ?? new Date(),
  );
}

describe('SyncJobRetryService', () => {
  let service: SyncJobRetryService;
  let mockRepository: jest.Mocked<Pick<SyncJobRepositoryPort, 'requeueDeadJob'>>;

  beforeEach(async () => {
    mockRepository = {
      requeueDeadJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncJobRetryService,
        {
          provide: SYNC_JOB_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get(SyncJobRetryService);
  });

  it('should requeue dead job via repository', async () => {
    const requeuedJob = makeSyncJob({ id: 'job-1', status: 'queued', attempts: 0 });
    mockRepository.requeueDeadJob.mockResolvedValue(requeuedJob);

    const result = await service.retryJob('job-1');

    expect(result.id).toBe('job-1');
    expect(result.status).toBe('queued');
    expect(mockRepository.requeueDeadJob).toHaveBeenCalledWith('job-1');
  });

  it('should propagate InvalidSyncJobStateError from repository', async () => {
    mockRepository.requeueDeadJob.mockRejectedValue(
      new InvalidSyncJobStateError('status', 'queued', 'job-1'),
    );

    await expect(service.retryJob('job-1')).rejects.toThrow(InvalidSyncJobStateError);
  });
});
