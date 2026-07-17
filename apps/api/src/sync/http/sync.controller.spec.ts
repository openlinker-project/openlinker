/**
 * Sync Controller Unit Tests
 *
 * Tests for the sync job management endpoints.
 *
 * @module apps/api/src/sync/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SyncController } from './sync.controller';
import type { JobEnqueuePort, SyncJobRequest, SyncJobRepositoryPort } from '@openlinker/core/sync';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_JOB_REPOSITORY_TOKEN,
  SYNC_JOB_RETRY_SERVICE_TOKEN,
  SYNC_JOB_BULK_RETRY_SERVICE_TOKEN,
  SyncJobEntity,
} from '@openlinker/core/sync';
import type { EnqueueSyncJobDto } from './dto/enqueue-sync-job.dto';

function makeSyncJob(overrides: Partial<SyncJobEntity> = {}): SyncJobEntity {
  return new SyncJobEntity(
    overrides.id ?? 'job-1',
    overrides.jobType ?? 'marketplace.orders.poll',
    overrides.connectionId ?? 'conn-1',
    overrides.payload ?? {},
    overrides.status ?? 'queued',
    overrides.idempotencyKey ?? 'key-1',
    overrides.attempts ?? 0,
    overrides.maxAttempts ?? 10,
    overrides.nextRunAt ?? new Date('2026-01-01T00:00:00Z'),
    overrides.lockedAt ?? null,
    overrides.lockedBy ?? null,
    overrides.lastError ?? null,
    overrides.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    overrides.updatedAt ?? new Date('2026-01-01T00:00:00Z')
  );
}

describe('SyncController', () => {
  let controller: SyncController;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let syncJobRepository: jest.Mocked<SyncJobRepositoryPort>;

  const mockJobEnqueue: jest.Mocked<JobEnqueuePort> = {
    enqueueJob: jest.fn(),
  };

  const mockSyncJobRepository: jest.Mocked<SyncJobRepositoryPort> = {
    createIfNotExistsByIdempotencyKey: jest.fn(),
    findAndLockDueJobs: jest.fn(),
    findById: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    findMany: jest.fn(),
    markSucceeded: jest.fn(),
    markFailed: jest.fn(),
    markDead: jest.fn(),
    requeueStuckJobs: jest.fn(),
    requeueDeadJob: jest.fn(),
    requeueDeadByIdempotencyKey: jest.fn(),
    findRecentByConnectionId: jest.fn(),
    findGroupedByStatus: jest.fn(),
    requeueDeadJobsInGroup: jest.fn(),
  };

  const mockRetryService = {
    retryJob: jest.fn(),
  };

  const mockBulkRetryService = {
    retryGroup: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        { provide: JOB_ENQUEUE_TOKEN, useValue: mockJobEnqueue },
        { provide: SYNC_JOB_REPOSITORY_TOKEN, useValue: mockSyncJobRepository },
        { provide: SYNC_JOB_RETRY_SERVICE_TOKEN, useValue: mockRetryService },
        { provide: SYNC_JOB_BULK_RETRY_SERVICE_TOKEN, useValue: mockBulkRetryService },
      ],
    }).compile();

    controller = module.get<SyncController>(SyncController);
    jobEnqueue = module.get(JOB_ENQUEUE_TOKEN);
    syncJobRepository = module.get(SYNC_JOB_REPOSITORY_TOKEN);

    jest.clearAllMocks();
  });

  describe('enqueueJob', () => {
    const validDto: EnqueueSyncJobDto = {
      jobType: 'marketplace.orders.poll',
      connectionId: '123e4567-e89b-12d3-a456-426614174000',
      payload: {
        schemaVersion: 1,
        cursorKey: 'allegro.orders.lastEventId',
        limit: 10,
      },
      idempotencyKey: 'marketplace:123e4567-e89b-12d3-a456-426614174000:orders:poll-1',
    };

    it('should enqueue a job successfully', async () => {
      const expectedJobId = '1704110400000-0';
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: expectedJobId, isExisting: false });

      const result = await controller.enqueueJob(validDto);

      expect(result).toEqual({
        jobId: expectedJobId,
        jobType: validDto.jobType,
        connectionId: validDto.connectionId,
        isExisting: false,
      });

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith({
        jobType: validDto.jobType,
        connectionId: validDto.connectionId,
        payload: validDto.payload,
        idempotencyKey: validDto.idempotencyKey,
      } as SyncJobRequest);
    });

    it('should detect existing job (idempotent)', async () => {
      const existingJobId = 'marketplace:123e4567-e89b-12d3-a456-426614174000:orders:poll-1';
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: existingJobId, isExisting: true });

      const result = await controller.enqueueJob(validDto);

      expect(result).toEqual({
        jobId: existingJobId,
        jobType: validDto.jobType,
        connectionId: validDto.connectionId,
        isExisting: true,
      });
    });

    it('should throw BadRequestException when enqueue fails', async () => {
      const errorMessage = 'Failed to enqueue job to stream: jobs.sync';
      jobEnqueue.enqueueJob.mockRejectedValue(new Error(errorMessage));

      await expect(controller.enqueueJob(validDto)).rejects.toThrow(BadRequestException);
      await expect(controller.enqueueJob(validDto)).rejects.toThrow(
        `Failed to enqueue job: ${errorMessage}`
      );

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
    });

    it('should handle unknown errors', async () => {
      jobEnqueue.enqueueJob.mockRejectedValue('Unknown error');

      await expect(controller.enqueueJob(validDto)).rejects.toThrow(BadRequestException);
      await expect(controller.enqueueJob(validDto)).rejects.toThrow(
        'Failed to enqueue job: Unknown error'
      );
    });

    it('should handle different job types', async () => {
      const jobTypes = [
        'marketplace.orders.poll',
        'marketplace.order.sync',
        'marketplace.offerQuantity.update',
        'master.product.syncByExternalId',
      ];

      for (const jobType of jobTypes) {
        const dto: EnqueueSyncJobDto = {
          ...validDto,
          jobType,
          idempotencyKey: `test:${jobType}:1`,
        };

        jobEnqueue.enqueueJob.mockResolvedValue({ jobId: `job-${jobType}`, isExisting: false });

        const result = await controller.enqueueJob(dto);

        expect(result.jobType).toBe(jobType);
        expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ jobType }));
      }
    });
  });

  describe('listJobs', () => {
    it('should return paginated response', async () => {
      syncJobRepository.findMany.mockResolvedValue({ items: [makeSyncJob()], total: 1 });

      const result = await controller.listJobs({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('should pass filters to repository', async () => {
      syncJobRepository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listJobs({
        status: 'dead',
        connectionId: 'conn-abc',
        jobType: 'marketplace.offers.sync',
        limit: 5,
        offset: 10,
      });

      expect(syncJobRepository.findMany).toHaveBeenCalledWith(
        { status: 'dead', connectionId: 'conn-abc', jobType: 'marketplace.offers.sync' },
        { limit: 5, offset: 10 }
      );
    });

    it('should serialize Date fields to ISO strings', async () => {
      syncJobRepository.findMany.mockResolvedValue({ items: [makeSyncJob()], total: 1 });

      const result = await controller.listJobs({});

      expect(result.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.items[0].nextRunAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('getJob', () => {
    it('should return job DTO when job exists', async () => {
      syncJobRepository.findById.mockResolvedValue(makeSyncJob({ lastError: 'boom', attempts: 2 }));

      const result = await controller.getJob('job-1');

      expect(result.id).toBe('job-1');
      expect(result.lastError).toBe('boom');
      expect(result.attempts).toBe(2);
    });

    it('should throw NotFoundException when job does not exist', async () => {
      syncJobRepository.findById.mockResolvedValue(null);

      await expect(controller.getJob('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('lookupJobForWebhookEvent', () => {
    it('should assemble the idempotency key from the components and return the job DTO', async () => {
      syncJobRepository.findByIdempotencyKey.mockResolvedValue(makeSyncJob({ id: 'job-1' }));

      const result = await controller.lookupJobForWebhookEvent('prestashop', 'conn-1', 'evt_42');

      // Server assembles the key from the raw components — the caller never
      // encodes the format (#1366).
      expect(syncJobRepository.findByIdempotencyKey).toHaveBeenCalledWith(
        'prestashop:conn-1:evt_42',
      );
      expect(result.id).toBe('job-1');
    });

    it('should throw BadRequestException when any component is missing or blank', async () => {
      await expect(
        controller.lookupJobForWebhookEvent(undefined, 'conn-1', 'evt_42'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.lookupJobForWebhookEvent('prestashop', '   ', 'evt_42'),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.lookupJobForWebhookEvent('prestashop', 'conn-1', undefined),
      ).rejects.toThrow(BadRequestException);
      expect(syncJobRepository.findByIdempotencyKey).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when no job matches the key yet', async () => {
      syncJobRepository.findByIdempotencyKey.mockResolvedValue(null);

      await expect(
        controller.lookupJobForWebhookEvent('prestashop', 'conn-1', 'evt_unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
