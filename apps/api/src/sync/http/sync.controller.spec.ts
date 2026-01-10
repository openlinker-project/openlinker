/**
 * Sync Controller Unit Tests
 *
 * Tests for the sync job management endpoints.
 *
 * @module apps/api/src/sync/http
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN, SyncJobRequest } from '@openlinker/core/sync';
import { EnqueueSyncJobDto } from './dto/enqueue-sync-job.dto';

describe('SyncController', () => {
  let controller: SyncController;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  const mockJobEnqueue: jest.Mocked<JobEnqueuePort> = {
    enqueueJob: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        {
          provide: JOB_ENQUEUE_TOKEN,
          useValue: mockJobEnqueue,
        },
      ],
    }).compile();

    controller = module.get<SyncController>(SyncController);
    jobEnqueue = module.get(JOB_ENQUEUE_TOKEN);

    jest.clearAllMocks();
  });

  describe('enqueueJob', () => {
    const validDto: EnqueueSyncJobDto = {
      jobType: 'allegro.orders.poll',
      connectionId: '123e4567-e89b-12d3-a456-426614174000',
      payload: {
        cursorKey: 'allegro.orders.lastEventId',
        limit: 10,
      },
      idempotencyKey: 'allegro:123e4567-e89b-12d3-a456-426614174000:poll-1',
    };

    it('should enqueue a job successfully', async () => {
      const expectedJobId = '1704110400000-0';
      jobEnqueue.enqueueJob.mockResolvedValue(expectedJobId);

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
      const existingJobId = 'existing:allegro:123e4567-e89b-12d3-a456-426614174000:poll-1';
      jobEnqueue.enqueueJob.mockResolvedValue(existingJobId);

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
        `Failed to enqueue job: ${errorMessage}`,
      );

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
    });

    it('should handle unknown errors', async () => {
      jobEnqueue.enqueueJob.mockRejectedValue('Unknown error');

      await expect(controller.enqueueJob(validDto)).rejects.toThrow(BadRequestException);
      await expect(controller.enqueueJob(validDto)).rejects.toThrow('Failed to enqueue job: Unknown error');
    });

    it('should handle different job types', async () => {
      const jobTypes = [
        'allegro.orders.poll',
        'allegro.order.syncByCheckoutFormId',
        'allegro.offerQuantity.update',
        'prestashop.product.syncByExternalId',
      ];

      for (const jobType of jobTypes) {
        const dto: EnqueueSyncJobDto = {
          ...validDto,
          jobType,
          idempotencyKey: `test:${jobType}:1`,
        };

        jobEnqueue.enqueueJob.mockResolvedValue(`job-${jobType}`);

        const result = await controller.enqueueJob(dto);

        expect(result.jobType).toBe(jobType);
        expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
          expect.objectContaining({
            jobType,
          }),
        );
      }
    });
  });
});

