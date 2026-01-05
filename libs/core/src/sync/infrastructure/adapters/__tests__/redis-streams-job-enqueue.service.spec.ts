/**
 * Redis Streams Job Enqueue Service Unit Tests
 *
 * Unit tests for RedisStreamsJobEnqueueService, verifying job enqueueing,
 * idempotency handling, and error handling.
 *
 * @module libs/core/src/sync/infrastructure/adapters
 */
import { Test, TestingModule } from '@nestjs/testing';
import { RedisStreamsJobEnqueueService } from '../redis-streams-job-enqueue.service';
import { RedisClientType } from 'redis';
import { SyncJobRequest } from '@openlinker/core/sync/domain/types/sync-job.types';
import { randomUUID } from 'crypto';

describe('RedisStreamsJobEnqueueService', () => {
  let service: RedisStreamsJobEnqueueService;
  let redisClient: jest.Mocked<RedisClientType>;

  beforeEach(async () => {
    const mockRedisClient = {
      set: jest.fn(),
      xAdd: jest.fn(),
      del: jest.fn(),
    } as unknown as jest.Mocked<RedisClientType>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisStreamsJobEnqueueService,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedisClient,
        },
      ],
    }).compile();

    service = module.get<RedisStreamsJobEnqueueService>(RedisStreamsJobEnqueueService);
    redisClient = module.get('REDIS_CLIENT');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enqueueJob', () => {
    const createJobRequest = (overrides?: Partial<SyncJobRequest>): SyncJobRequest => ({
      jobType: 'prestashop.product.syncByExternalId',
      connectionId: randomUUID(),
      payload: { externalId: '1', objectType: 'Product' },
      idempotencyKey: `test-key-${randomUUID()}`,
      ...overrides,
    });

    it('should enqueue job successfully and return message ID', async () => {
      const jobRequest = createJobRequest();
      const messageId = '123-0';
      const idempotencyKey = `jobdedup:${jobRequest.idempotencyKey}`;

      redisClient.set.mockResolvedValueOnce('OK'); // SET NX succeeds
      redisClient.xAdd.mockResolvedValueOnce(messageId);
      redisClient.set.mockResolvedValueOnce('OK'); // Update idempotency key with message ID

      const result = await service.enqueueJob(jobRequest);

      expect(result).toBe(messageId);
      expect(redisClient.set).toHaveBeenCalledWith(
        idempotencyKey,
        'enqueued',
        {
          NX: true,
          EX: 7 * 24 * 60 * 60, // 7 days
        },
      );
      expect(redisClient.xAdd).toHaveBeenCalledWith(
        'jobs.sync',
        '*',
        expect.objectContaining({
          jobType: jobRequest.jobType,
          connectionId: jobRequest.connectionId,
          payloadJson: JSON.stringify(jobRequest.payload),
          idempotencyKey: jobRequest.idempotencyKey,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          createdAt: expect.any(String),
        }),
      );
      expect(redisClient.set).toHaveBeenCalledWith(
        idempotencyKey,
        messageId,
        {
          XX: true,
          EX: 7 * 24 * 60 * 60,
        },
      );
    });

    it('should return existing job ID when idempotency key already exists', async () => {
      const jobRequest = createJobRequest();
      const idempotencyKey = `jobdedup:${jobRequest.idempotencyKey}`;

      redisClient.set.mockResolvedValueOnce(null); // SET NX returns null (key exists)

      const result = await service.enqueueJob(jobRequest);

      expect(result).toBe(`existing:${jobRequest.idempotencyKey}`);
      expect(redisClient.set).toHaveBeenCalledWith(
        idempotencyKey,
        'enqueued',
        {
          NX: true,
          EX: 7 * 24 * 60 * 60,
        },
      );
      expect(redisClient.xAdd).not.toHaveBeenCalled();
    });

    it('should format payload as JSON string', async () => {
      const jobRequest = createJobRequest({
        payload: {
          externalId: '123',
          objectType: 'Product',
          eventType: 'product.updated',
          metadata: {
            timestamp: '2025-01-01T00:00:00Z',
          },
        },
      });
      const messageId = '123-0';

      redisClient.set.mockResolvedValueOnce('OK');
      redisClient.xAdd.mockResolvedValueOnce(messageId);
      redisClient.set.mockResolvedValueOnce('OK');

      await service.enqueueJob(jobRequest);

      expect(redisClient.xAdd).toHaveBeenCalledWith(
        'jobs.sync',
        '*',
        expect.objectContaining({
          payloadJson: JSON.stringify(jobRequest.payload),
        }),
      );
    });

    it('should include createdAt timestamp in fields', async () => {
      const jobRequest = createJobRequest();
      const messageId = '123-0';

      redisClient.set.mockResolvedValueOnce('OK');
      redisClient.xAdd.mockResolvedValueOnce(messageId);
      redisClient.set.mockResolvedValueOnce('OK');

      await service.enqueueJob(jobRequest);

      const xAddCall = redisClient.xAdd.mock.calls[0];
      const fields = xAddCall[2] as Record<string, string>;
      expect(fields.createdAt).toBeDefined();
      expect(new Date(fields.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should clean up idempotency key if XADD fails', async () => {
      const jobRequest = createJobRequest();
      const idempotencyKey = `jobdedup:${jobRequest.idempotencyKey}`;

      redisClient.set.mockResolvedValueOnce('OK');
      redisClient.xAdd.mockRejectedValueOnce(new Error('XADD failed')); // XADD fails
      redisClient.del.mockResolvedValueOnce(1);

      await expect(service.enqueueJob(jobRequest)).rejects.toThrow(
        'Failed to enqueue job to stream: jobs.sync',
      );

      expect(redisClient.del).toHaveBeenCalledWith(idempotencyKey);
    });

    it('should handle Redis connection errors', async () => {
      const jobRequest = createJobRequest();
      const error = new Error('Connection to Redis failed');

      redisClient.set.mockRejectedValueOnce(error);

      await expect(service.enqueueJob(jobRequest)).rejects.toThrow(
        'Job enqueue failed: Connection to Redis failed',
      );
    });

    it('should handle XADD errors', async () => {
      const jobRequest = createJobRequest();
      const idempotencyKey = `jobdedup:${jobRequest.idempotencyKey}`;
      const error = new Error('Stream write failed');

      redisClient.set.mockResolvedValueOnce('OK');
      redisClient.xAdd.mockRejectedValueOnce(error);
      redisClient.del.mockResolvedValueOnce(1);

      await expect(service.enqueueJob(jobRequest)).rejects.toThrow(
        'Failed to enqueue job to stream: jobs.sync',
      );

      expect(redisClient.del).toHaveBeenCalledWith(idempotencyKey);
    });

    it('should handle non-Error exceptions', async () => {
      const jobRequest = createJobRequest();

      redisClient.set.mockRejectedValueOnce('String error');

      await expect(service.enqueueJob(jobRequest)).rejects.toThrow(
        'Job enqueue failed: Unknown error',
      );
    });

    it('should set idempotency key TTL to 7 days', async () => {
      const jobRequest = createJobRequest();
      const messageId = '123-0';
      const expectedTtl = 7 * 24 * 60 * 60; // 7 days in seconds

      redisClient.set.mockResolvedValueOnce('OK');
      redisClient.xAdd.mockResolvedValueOnce(messageId);
      redisClient.set.mockResolvedValueOnce('OK');

      await service.enqueueJob(jobRequest);

      // Check both SET calls have correct TTL
      const setCalls = redisClient.set.mock.calls;
      expect(setCalls[0][2]).toMatchObject({ EX: expectedTtl });
      expect(setCalls[1][2]).toMatchObject({ EX: expectedTtl });
    });

    it('should handle complex payload objects', async () => {
      const complexPayload = {
        externalId: '123',
        objectType: 'Product',
        eventType: 'product.updated',
        metadata: {
          timestamp: '2025-01-01T00:00:00Z',
          source: 'webhook',
          nested: {
            value: 42,
            array: [1, 2, 3],
          },
        },
      };

      const jobRequest = createJobRequest({ payload: complexPayload });
      const messageId = '123-0';

      redisClient.set.mockResolvedValueOnce('OK');
      redisClient.xAdd.mockResolvedValueOnce(messageId);
      redisClient.set.mockResolvedValueOnce('OK');

      await service.enqueueJob(jobRequest);

      expect(redisClient.xAdd).toHaveBeenCalledWith(
        'jobs.sync',
        '*',
        expect.objectContaining({
          payloadJson: JSON.stringify(complexPayload),
        }),
      );
    });

    it('should handle empty payload', async () => {
      const jobRequest = createJobRequest({ payload: {} });
      const messageId = '123-0';

      redisClient.set.mockResolvedValueOnce('OK');
      redisClient.xAdd.mockResolvedValueOnce(messageId);
      redisClient.set.mockResolvedValueOnce('OK');

      await service.enqueueJob(jobRequest);

      expect(redisClient.xAdd).toHaveBeenCalledWith(
        'jobs.sync',
        '*',
        expect.objectContaining({
          payloadJson: '{}',
        }),
      );
    });
  });
});

