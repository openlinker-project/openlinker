/**
 * Job Intake Consumer Unit Tests
 *
 * Unit tests for JobIntakeConsumer, verifying Redis Stream consumption,
 * message parsing, job persistence, error handling, and idempotency.
 *
 * @module apps/worker/src/sync
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JobIntakeConsumer } from '../job-intake.consumer';
import { RedisClientType } from 'redis';
import { SyncJobRepositoryPort } from '@openlinker/core/sync/domain/ports/sync-job-repository.port';
import { SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { SyncJobRequest, JobTypeValues } from '@openlinker/core/sync/domain/types/sync-job.types';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { randomUUID } from 'crypto';

describe('JobIntakeConsumer', () => {
  let consumer: JobIntakeConsumer;
  let redisClient: jest.Mocked<RedisClientType>;
  let jobRepository: jest.Mocked<SyncJobRepositoryPort>;
  let module: TestingModule;

  beforeEach(async () => {
    // Mock Redis client
    const mockRedisClient = {
      xGroupCreate: jest.fn(),
      xReadGroup: jest.fn(),
      xAck: jest.fn(),
    } as unknown as jest.Mocked<RedisClientType>;

    // Mock repository
    const mockRepository = {
      createIfNotExistsByIdempotencyKey: jest.fn(),
      markDead: jest.fn(),
    } as unknown as jest.Mocked<SyncJobRepositoryPort>;

    module = await Test.createTestingModule({
      providers: [
        JobIntakeConsumer,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedisClient,
        },
        {
          provide: SYNC_JOB_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string) => {
              // Return env var or default (env vars set in jest.setup.ts)
              return process.env[key] ?? defaultValue ?? 'true';
            }),
          },
        },
      ],
    }).compile();

    consumer = module.get<JobIntakeConsumer>(JobIntakeConsumer);
    redisClient = module.get('REDIS_CLIENT');
    jobRepository = module.get(SYNC_JOB_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    // Stop any running consumption loops
    if (consumer) {
      (consumer as any).isRunning = false;
      if ((consumer as any).abortController) {
        // Check if it's an actual AbortController instance
        if (typeof (consumer as any).abortController.abort === 'function') {
          (consumer as any).abortController.abort();
        } else {
          // It's a mock object, just set aborted flag
          (consumer as any).abortController.signal = { aborted: true };
        }
      }
    }
    // Clear all timers and restore real timers before calling onModuleDestroy
    // (onModuleDestroy has a setTimeout that needs real timers)
    jest.clearAllTimers();
    jest.useRealTimers();
    
    // Now safely call onModuleDestroy with real timers
    if (consumer) {
      try {
        await consumer.onModuleDestroy();
      } catch {
        // Ignore errors during cleanup
      }
    }
    
    // Clear all mocks
    jest.clearAllMocks();
  });

  describe('processMessage', () => {
    const createValidFields = (): Record<string, string> => ({
      jobType: 'prestashop.product.syncByExternalId',
      connectionId: randomUUID(),
      payloadJson: JSON.stringify({ externalId: '1', objectType: 'Product' }),
      idempotencyKey: `test-key-${randomUUID()}`,
    });

    it('should parse valid job request and persist to database', async () => {
      const messageId = '123-0';
      const fields = createValidFields();
      const mockJob = new SyncJob(
        randomUUID(),
        'prestashop.product.syncByExternalId',
        fields.connectionId,
        JSON.parse(fields.payloadJson),
        'queued',
        fields.idempotencyKey,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      jobRepository.createIfNotExistsByIdempotencyKey.mockResolvedValueOnce(mockJob);
      redisClient.xAck.mockResolvedValueOnce(1);

      await (consumer as any).processMessage(messageId, fields);

      expect(jobRepository.createIfNotExistsByIdempotencyKey).toHaveBeenCalledWith({
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: fields.connectionId,
        payload: JSON.parse(fields.payloadJson),
        idempotencyKey: fields.idempotencyKey,
        maxAttempts: 10,
      });
      expect(redisClient.xAck).toHaveBeenCalledWith('jobs.sync', 'job-intake', messageId);
    });

    it('should handle unknown job type by persisting as dead job', async () => {
      const messageId = '123-0';
      const validFields = createValidFields();
      const fields: Record<string, string> = {
        ...validFields,
        jobType: 'unknown.job.type',
      };
      const mockJob = new SyncJob(
        randomUUID(),
        JobTypeValues[0], // Placeholder valid job type
        fields.connectionId,
        {},
        'queued',
        fields.idempotencyKey,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      jobRepository.createIfNotExistsByIdempotencyKey.mockResolvedValueOnce(mockJob);
      jobRepository.markDead.mockResolvedValueOnce(undefined);
      redisClient.xAck.mockResolvedValueOnce(1);

      await (consumer as any).processMessage(messageId, fields);

      expect(jobRepository.createIfNotExistsByIdempotencyKey).toHaveBeenCalled();
      expect(jobRepository.markDead).toHaveBeenCalledWith(
        mockJob.id,
        'Unknown job type: unknown.job.type',
      );
      expect(redisClient.xAck).toHaveBeenCalledWith('jobs.sync', 'job-intake', messageId);
    });

    it('should handle invalid JSON in payloadJson', async () => {
      const messageId = '123-0';
      const validFields = createValidFields();
      const fields: Record<string, string> = {
        ...validFields,
        payloadJson: 'invalid-json{',
      };
      const mockJob = new SyncJob(
        randomUUID(),
        JobTypeValues[0],
        fields.connectionId,
        {},
        'queued',
        fields.idempotencyKey,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      jobRepository.createIfNotExistsByIdempotencyKey.mockResolvedValueOnce(mockJob);
      jobRepository.markDead.mockResolvedValueOnce(undefined);
      redisClient.xAck.mockResolvedValueOnce(1);

      await (consumer as any).processMessage(messageId, fields);

      expect(jobRepository.createIfNotExistsByIdempotencyKey).toHaveBeenCalled();
      expect(jobRepository.markDead).toHaveBeenCalled();
      expect(redisClient.xAck).toHaveBeenCalledWith('jobs.sync', 'job-intake', messageId);
    });

    it('should handle missing required fields', async () => {
      const messageId = '123-0';
      const fields = {
        jobType: 'prestashop.product.syncByExternalId',
        // Missing connectionId, payloadJson, idempotencyKey
      };
      const mockJob = new SyncJob(
        randomUUID(),
        JobTypeValues[0],
        'unknown',
        {},
        'queued',
        `invalid-${messageId}`,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      jobRepository.createIfNotExistsByIdempotencyKey.mockResolvedValueOnce(mockJob);
      jobRepository.markDead.mockResolvedValueOnce(undefined);
      redisClient.xAck.mockResolvedValueOnce(1);

      await (consumer as any).processMessage(messageId, fields);

      expect(jobRepository.createIfNotExistsByIdempotencyKey).toHaveBeenCalled();
      expect(jobRepository.markDead).toHaveBeenCalled();
      expect(redisClient.xAck).toHaveBeenCalledWith('jobs.sync', 'job-intake', messageId);
    });

    it('should not ACK message on repository error (will retry)', async () => {
      const messageId = '123-0';
      const fields = createValidFields();
      const error = new Error('Database connection failed');

      jobRepository.createIfNotExistsByIdempotencyKey.mockRejectedValueOnce(error);

      await expect((consumer as any).processMessage(messageId, fields)).rejects.toThrow(
        'Database connection failed',
      );

      expect(redisClient.xAck).not.toHaveBeenCalled();
    });

    it('should ACK message on invalid message format error (prevents infinite retry)', async () => {
      const messageId = '123-0';
      const fields = {
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: randomUUID(),
        payloadJson: 'invalid-json',
        idempotencyKey: `test-key-${randomUUID()}`,
      };
      const mockJob = new SyncJob(
        randomUUID(),
        JobTypeValues[0],
        fields.connectionId,
        {},
        'queued',
        fields.idempotencyKey,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      jobRepository.createIfNotExistsByIdempotencyKey.mockResolvedValueOnce(mockJob);
      jobRepository.markDead.mockResolvedValueOnce(undefined);
      redisClient.xAck.mockResolvedValueOnce(1);

      await (consumer as any).processMessage(messageId, fields);

      expect(jobRepository.markDead).toHaveBeenCalled();
      expect(redisClient.xAck).toHaveBeenCalledWith('jobs.sync', 'job-intake', messageId);
    });
  });

  describe('parseJobRequest', () => {
    it('should parse valid job request fields', () => {
      const fields: Record<string, string> = {
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: randomUUID(),
        payloadJson: JSON.stringify({ externalId: '1', objectType: 'Product' }),
        idempotencyKey: `test-key-${randomUUID()}`,
      };

      const result = (consumer as any).parseJobRequest(fields);

      expect(result).toEqual({
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: fields.connectionId,
        payload: { externalId: '1', objectType: 'Product' },
        idempotencyKey: fields.idempotencyKey,
      });
    });

    it('should throw error when jobType is missing', () => {
      const fields: Record<string, string> = {
        connectionId: randomUUID(),
        payloadJson: JSON.stringify({}),
        idempotencyKey: `test-key-${randomUUID()}`,
      };

      expect(() => (consumer as any).parseJobRequest(fields)).toThrow('Missing required fields');
    });

    it('should throw error when connectionId is missing', () => {
      const fields: Record<string, string> = {
        jobType: 'prestashop.product.syncByExternalId',
        payloadJson: JSON.stringify({}),
        idempotencyKey: `test-key-${randomUUID()}`,
      };

      expect(() => (consumer as any).parseJobRequest(fields)).toThrow('Missing required fields');
    });

    it('should throw error when payloadJson is missing', () => {
      const fields: Record<string, string> = {
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: randomUUID(),
        idempotencyKey: `test-key-${randomUUID()}`,
      };

      expect(() => (consumer as any).parseJobRequest(fields)).toThrow('Missing required fields');
    });

    it('should throw error when idempotencyKey is missing', () => {
      const fields: Record<string, string> = {
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: randomUUID(),
        payloadJson: JSON.stringify({}),
      };

      expect(() => (consumer as any).parseJobRequest(fields)).toThrow('Missing required fields');
    });

    it('should throw error when payloadJson is invalid JSON', () => {
      const fields: Record<string, string> = {
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: randomUUID(),
        payloadJson: 'invalid-json{',
        idempotencyKey: `test-key-${randomUUID()}`,
      };

      expect(() => (consumer as any).parseJobRequest(fields)).toThrow('Invalid JSON');
    });

    it('should parse complex payload JSON', () => {
      const complexPayload = {
        externalId: '123',
        objectType: 'Product',
        eventType: 'product.updated',
        metadata: {
          timestamp: '2025-01-01T00:00:00Z',
          source: 'webhook',
        },
      };

      const fields: Record<string, string> = {
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: randomUUID(),
        payloadJson: JSON.stringify(complexPayload),
        idempotencyKey: `test-key-${randomUUID()}`,
      };

      const result = (consumer as any).parseJobRequest(fields);

      expect(result.payload).toEqual(complexPayload);
    });
  });

  describe('isValidJobType', () => {
    it('should return true for valid job types', () => {
      for (const jobType of JobTypeValues) {
        expect((consumer as any).isValidJobType(jobType)).toBe(true);
      }
    });

    it('should return false for invalid job types', () => {
      const invalidTypes = [
        'unknown.job.type',
        'prestashop.invalid.type',
        '',
        'not-a-job-type',
      ];

      for (const invalidType of invalidTypes) {
        expect((consumer as any).isValidJobType(invalidType)).toBe(false);
      }
    });
  });

  describe('persistDeadJob', () => {
    it('should create dead job with placeholder job type', async () => {
      const jobRequest: SyncJobRequest = {
        jobType: 'unknown.job.type' as any,
        connectionId: randomUUID(),
        payload: { externalId: '1' },
        idempotencyKey: `test-key-${randomUUID()}`,
      };
      const errorMessage = 'Unknown job type: unknown.job.type';

      const mockJob = new SyncJob(
        randomUUID(),
        JobTypeValues[0], // Placeholder
        jobRequest.connectionId,
        {
          ...jobRequest.payload,
          _originalJobType: jobRequest.jobType,
          _invalidJobType: true,
        },
        'queued',
        jobRequest.idempotencyKey,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      jobRepository.createIfNotExistsByIdempotencyKey.mockResolvedValueOnce(mockJob);
      jobRepository.markDead.mockResolvedValueOnce(undefined);

      await (consumer as any).persistDeadJob(jobRequest, errorMessage);

      expect(jobRepository.createIfNotExistsByIdempotencyKey).toHaveBeenCalledWith({
        jobType: JobTypeValues[0], // Placeholder
        connectionId: jobRequest.connectionId,
        payload: {
          ...jobRequest.payload,
          _originalJobType: jobRequest.jobType,
          _invalidJobType: true,
        },
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10,
      });
      expect(jobRepository.markDead).toHaveBeenCalledWith(mockJob.id, errorMessage);
    });
  });

  describe('initializeConsumerGroup', () => {
    it('should create consumer group successfully', async () => {
      redisClient.xGroupCreate.mockResolvedValueOnce('OK');

      await (consumer as any).initializeConsumerGroup();

      expect(redisClient.xGroupCreate).toHaveBeenCalledWith(
        'jobs.sync',
        'job-intake',
        '$',
        { MKSTREAM: true },
      );
    });

    it('should ignore BUSYGROUP error (group already exists)', async () => {
      const busyGroupError = new Error('BUSYGROUP Consumer Group name already exists');
      redisClient.xGroupCreate.mockRejectedValueOnce(busyGroupError);

      await (consumer as any).initializeConsumerGroup();

      expect(redisClient.xGroupCreate).toHaveBeenCalled();
      // Should not throw
    });

    it('should throw error for non-BUSYGROUP errors', async () => {
      const otherError = new Error('Redis connection failed');
      redisClient.xGroupCreate.mockRejectedValueOnce(otherError);

      await expect((consumer as any).initializeConsumerGroup()).rejects.toThrow(
        'Redis connection failed',
      );
    });
  });

  describe('consumeLoop', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      // Stop any running loops
      if (consumer) {
        (consumer as any).isRunning = false;
        if ((consumer as any).abortController) {
          if (typeof (consumer as any).abortController.abort === 'function') {
            (consumer as any).abortController.abort();
          } else {
            (consumer as any).abortController.signal = { aborted: true };
          }
        }
      }
      // Clear all timers before restoring
      jest.clearAllTimers();
      jest.useRealTimers();
    });

    it('should read messages from stream and process them', async () => {
      const messageId = '123-0';
      const fields = {
        jobType: 'prestashop.product.syncByExternalId',
        connectionId: randomUUID(),
        payloadJson: JSON.stringify({ externalId: '1' }),
        idempotencyKey: `test-key-${randomUUID()}`,
      };

      const mockJob = new SyncJob(
        randomUUID(),
        'prestashop.product.syncByExternalId',
        fields.connectionId,
        JSON.parse(fields.payloadJson),
        'queued',
        fields.idempotencyKey,
        0,
        10,
        new Date(),
        null,
        null,
        null,
        new Date(),
        new Date(),
      );

      redisClient.xReadGroup
        .mockResolvedValueOnce([
          {
            name: 'jobs.sync',
            messages: [
              {
                id: messageId,
                message: fields,
              },
            ],
          },
        ])
        .mockResolvedValueOnce(null); // No more messages

      jobRepository.createIfNotExistsByIdempotencyKey.mockResolvedValue(mockJob);
      redisClient.xAck.mockResolvedValue(1);

      (consumer as any).isRunning = true;
      (consumer as any).abortController = { signal: { aborted: false } };

      const consumeLoopPromise = (consumer as any).consumeLoop();

      // Fast-forward time
      jest.advanceTimersByTime(100);

      // Stop loop
      (consumer as any).isRunning = false;
      (consumer as any).abortController = { signal: { aborted: true } };

      await consumeLoopPromise.catch(() => {
        // Expected when aborted
      });

      expect(redisClient.xReadGroup).toHaveBeenCalled();
      expect(jobRepository.createIfNotExistsByIdempotencyKey).toHaveBeenCalled();
      expect(redisClient.xAck).toHaveBeenCalled();
    });

    it('should continue loop when no messages are available', async () => {
      redisClient.xReadGroup.mockResolvedValue(null);

      (consumer as any).isRunning = true;
      (consumer as any).abortController = { signal: { aborted: false } };

      const consumeLoopPromise = (consumer as any).consumeLoop();

      // Fast-forward time
      jest.advanceTimersByTime(6000); // Past BLOCK_MS

      // Stop loop
      (consumer as any).isRunning = false;
      (consumer as any).abortController = { signal: { aborted: true } };

      await consumeLoopPromise.catch(() => {
        // Expected when aborted
      });

      expect(redisClient.xReadGroup).toHaveBeenCalled();
    });

    it('should handle Redis connection errors with longer backoff', async () => {
      const connectionError = new Error('Connection to Redis failed');
      redisClient.xReadGroup.mockRejectedValueOnce(connectionError);

      (consumer as any).isRunning = true;
      (consumer as any).abortController = { signal: { aborted: false } };

      const consumeLoopPromise = (consumer as any).consumeLoop();

      // Fast-forward past backoff (5 seconds for connection errors)
      jest.advanceTimersByTime(6000);

      // Stop loop
      (consumer as any).isRunning = false;
      (consumer as any).abortController = { signal: { aborted: true } };

      await consumeLoopPromise.catch(() => {
        // Expected when aborted
      });

      expect(redisClient.xReadGroup).toHaveBeenCalled();
    });

    it('should stop when abort signal is received', async () => {
      redisClient.xReadGroup.mockResolvedValue(null);

      (consumer as any).isRunning = true;
      const abortController = new AbortController();
      (consumer as any).abortController = abortController;

      const consumeLoopPromise = (consumer as any).consumeLoop();

      // Abort immediately
      abortController.abort();

      await consumeLoopPromise.catch(() => {
        // Expected when aborted
      });

      expect(redisClient.xReadGroup).toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('should initialize consumer group and start consumption loop', async () => {
      // Override ConfigService to enable intake for this test
      const configService = module.get<ConfigService>(ConfigService);
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'WORKER_INTAKE_ENABLED') {
          return 'true'; // Enable intake for this test
        }
        return (process.env[key] ?? defaultValue ?? 'true') as string;
      });

      jest.spyOn(consumer as any, 'initializeConsumerGroup');
      jest.spyOn(consumer as any, 'startConsumptionLoop');

      redisClient.xGroupCreate.mockResolvedValueOnce('OK');

      await consumer.onModuleInit();

      expect((consumer as any).initializeConsumerGroup).toHaveBeenCalled();
      expect((consumer as any).startConsumptionLoop).toHaveBeenCalled();
    });

    it('should not start intake when WORKER_INTAKE_ENABLED=false', async () => {
      // Override ConfigService to disable intake for this test
      const configService = module.get<ConfigService>(ConfigService);
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'WORKER_INTAKE_ENABLED') {
          return 'false'; // Disable intake for this test
        }
        return (process.env[key] ?? defaultValue ?? 'true') as string;
      });

      jest.spyOn(consumer as any, 'initializeConsumerGroup');
      jest.spyOn(consumer as any, 'startConsumptionLoop');

      await consumer.onModuleInit();

      expect((consumer as any).initializeConsumerGroup).not.toHaveBeenCalled();
      expect((consumer as any).startConsumptionLoop).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop consumption loop', async () => {
      jest.useFakeTimers();
      jest.spyOn(consumer as any, 'stopConsumptionLoop');

      const destroyPromise = consumer.onModuleDestroy();

      // Advance timers to complete the setTimeout in stopConsumptionLoop
      jest.advanceTimersByTime(2000);
      await destroyPromise;

      expect((consumer as any).stopConsumptionLoop).toHaveBeenCalled();
    });

    afterEach(() => {
      jest.useRealTimers();
    });
  });
});

