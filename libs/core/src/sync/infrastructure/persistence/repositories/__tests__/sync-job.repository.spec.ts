/**
 * Sync Job Repository Unit Tests
 *
 * Unit tests for SyncJobRepository, verifying job persistence operations,
 * idempotency, locking behavior, retry logic, and stuck job recovery.
 *
 * @module libs/core/src/sync/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository, DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import { SyncJobRepository } from '../sync-job.repository';
import { SyncJobOrmEntity } from '../../entities/sync-job.orm-entity';
import { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import type { JobType } from '@openlinker/core/sync';
import { randomUUID } from 'crypto';

describe('SyncJobRepository', () => {
  let repository: SyncJobRepository;
  let ormRepository: jest.Mocked<Repository<SyncJobOrmEntity>>;
  let dataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    // Mock DataSource
    const mockDataSource = {
      transaction: jest.fn(),
      manager: {
        connection: {} as DataSource,
      },
    } as unknown as jest.Mocked<DataSource>;

    // Mock EntityManager
    const mockEntityManager = {
      query: jest.fn(),
      createQueryBuilder: jest.fn(),
      find: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    // Mock Repository
    const mockOrmRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        connection: mockDataSource,
      },
    } as unknown as jest.Mocked<Repository<SyncJobOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncJobRepository,
        {
          provide: getRepositoryToken(SyncJobOrmEntity),
          useValue: mockOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<SyncJobRepository>(SyncJobRepository);
    ormRepository = module.get(getRepositoryToken(SyncJobOrmEntity));
    dataSource = ormRepository.manager.connection as unknown as jest.Mocked<DataSource>;
    dataSource.transaction = jest
      .fn()
      .mockImplementation(
        async <T>(runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T> => {
          return runInTransaction(mockEntityManager);
        }
      );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createIfNotExistsByIdempotencyKey', () => {
    const jobRequest = {
      jobType: 'master.product.syncByExternalId' as JobType,
      connectionId: randomUUID(),
      payload: { schemaVersion: 1, externalId: '1', objectType: 'Product' },
      idempotencyKey: 'test-idempotency-key-1',
      maxAttempts: 10,
    };

    it('should create new job when idempotency key does not exist', async () => {
      const savedEntity = createMockOrmEntity({
        id: randomUUID(),
        idempotencyKey: jobRequest.idempotencyKey,
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payloadJson: jobRequest.payload,
        status: 'queued',
        attempts: 0,
        maxAttempts: jobRequest.maxAttempts,
      });

      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.createIfNotExistsByIdempotencyKey(jobRequest);

      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      expect(result.id).toBe(savedEntity.id);
      expect(result.idempotencyKey).toBe(jobRequest.idempotencyKey);
      expect(result.status).toBe('queued');
      expect(result.attempts).toBe(0);
    });

    it('should return existing job when idempotency key already exists (race condition)', async () => {
      const existingEntity = createMockOrmEntity({
        id: randomUUID(),
        idempotencyKey: jobRequest.idempotencyKey,
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payloadJson: jobRequest.payload,
        status: 'queued',
        attempts: 0,
        maxAttempts: jobRequest.maxAttempts,
      });

      // First call (create) throws unique constraint error
      const duplicateError = new QueryFailedError(
        'duplicate key value violates unique constraint',
        [],
        new Error('duplicate key')
      );
      ormRepository.save.mockRejectedValueOnce(duplicateError);

      // Second call (find existing) returns existing job
      ormRepository.findOne.mockResolvedValueOnce(existingEntity);

      const result = await repository.createIfNotExistsByIdempotencyKey(jobRequest);

      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { idempotencyKey: jobRequest.idempotencyKey },
      });
      expect(result.id).toBe(existingEntity.id);
      expect(result.idempotencyKey).toBe(jobRequest.idempotencyKey);
    });

    it('should throw error if existing job not found after unique constraint violation', async () => {
      const duplicateError = new QueryFailedError(
        'duplicate key value violates unique constraint',
        [],
        new Error('duplicate key')
      );
      ormRepository.save.mockRejectedValueOnce(duplicateError);
      ormRepository.findOne.mockResolvedValueOnce(null);

      await expect(repository.createIfNotExistsByIdempotencyKey(jobRequest)).rejects.toThrow(
        `Failed to create or find job by idempotency key: ${jobRequest.idempotencyKey}`
      );
    });

    it('should re-throw non-unique-constraint errors', async () => {
      const otherError = new Error('Database connection failed');
      ormRepository.save.mockRejectedValueOnce(otherError);

      await expect(repository.createIfNotExistsByIdempotencyKey(jobRequest)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should handle unique constraint error with "unique constraint" message', async () => {
      const existingEntity = createMockOrmEntity({
        id: randomUUID(),
        idempotencyKey: jobRequest.idempotencyKey,
      });

      const uniqueConstraintError = new QueryFailedError(
        'unique constraint violation',
        [],
        new Error('unique constraint')
      );
      ormRepository.save.mockRejectedValueOnce(uniqueConstraintError);
      ormRepository.findOne.mockResolvedValueOnce(existingEntity);

      const result = await repository.createIfNotExistsByIdempotencyKey(jobRequest);

      expect(result.id).toBe(existingEntity.id);
    });
  });

  describe('findAndLockDueJobs', () => {
    it('should find and lock queued jobs that are due', async () => {
      const workerId = 'worker-123';
      const limit = 10;
      const now = new Date();
      const pastDate = new Date(now.getTime() - 1000);

      const dueJob1 = createMockOrmEntity({
        id: randomUUID(),
        status: 'queued',
        nextRunAt: pastDate,
      });
      const dueJob2 = createMockOrmEntity({
        id: randomUUID(),
        status: 'queued',
        nextRunAt: pastDate,
      });

      // Create updated entities with 'running' status (after the update query)
      const now2 = new Date();
      const updatedJob1 = createMockOrmEntity({
        ...dueJob1,
        status: 'running',
        lockedAt: now2,
        lockedBy: workerId,
      });
      const updatedJob2 = createMockOrmEntity({
        ...dueJob2,
        status: 'running',
        lockedAt: now2,
        lockedBy: workerId,
      });

      const mockEntityManager = {
        query: jest.fn().mockResolvedValue([{ ...dueJob1 }, { ...dueJob2 }]),
        createQueryBuilder: jest.fn().mockReturnValue({
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          execute: jest.fn().mockResolvedValue({ affected: 2 }),
        }),
        find: jest.fn().mockResolvedValue([updatedJob1, updatedJob2]),
      } as unknown as jest.Mocked<EntityManager>;

      dataSource.transaction = jest
        .fn()
        .mockImplementation(
          async <T>(runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T> => {
            return runInTransaction(mockEntityManager);
          }
        );

      const result = await repository.findAndLockDueJobs(limit, workerId);

      expect(mockEntityManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE SKIP LOCKED'),
        ['queued', expect.any(Date), limit]
      );
      expect(mockEntityManager.createQueryBuilder).toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(dueJob1.id);
      expect(result[0].status).toBe('running');
      expect(result[1].id).toBe(dueJob2.id);
      expect(result[1].status).toBe('running');
    });

    it('should return empty array when no jobs are due', async () => {
      const workerId = 'worker-123';
      const limit = 10;

      const mockEntityManager = {
        query: jest.fn().mockResolvedValue([]),
      } as unknown as jest.Mocked<EntityManager>;

      dataSource.transaction = jest
        .fn()
        .mockImplementation(
          async <T>(runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T> => {
            return runInTransaction(mockEntityManager);
          }
        );

      const result = await repository.findAndLockDueJobs(limit, workerId);

      expect(result).toEqual([]);
      expect(mockEntityManager.query).toHaveBeenCalled();
    });

    it('should skip already locked jobs (FOR UPDATE SKIP LOCKED)', async () => {
      const workerId = 'worker-123';
      const limit = 10;

      const mockEntityManager = {
        query: jest.fn().mockResolvedValue([]), // SKIP LOCKED returns empty
      } as unknown as jest.Mocked<EntityManager>;

      dataSource.transaction = jest
        .fn()
        .mockImplementation(
          async <T>(runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T> => {
            return runInTransaction(mockEntityManager);
          }
        );

      const result = await repository.findAndLockDueJobs(limit, workerId);

      expect(result).toEqual([]);
      expect(mockEntityManager.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE SKIP LOCKED'),
        expect.any(Array)
      );
    });

    it('should update locked jobs with worker ID and timestamp', async () => {
      const workerId = 'worker-123';
      const limit = 10;
      const dueJob = createMockOrmEntity({
        id: randomUUID(),
        status: 'queued',
      });

      const updateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      const mockEntityManager = {
        query: jest.fn().mockResolvedValue([{ ...dueJob }]),
        createQueryBuilder: jest.fn().mockReturnValue(updateQueryBuilder),
        find: jest.fn().mockResolvedValue([dueJob]),
      } as unknown as jest.Mocked<EntityManager>;

      dataSource.transaction = jest
        .fn()
        .mockImplementation(
          async <T>(runInTransaction: (entityManager: EntityManager) => Promise<T>): Promise<T> => {
            return runInTransaction(mockEntityManager);
          }
        );

      await repository.findAndLockDueJobs(limit, workerId);

      expect(updateQueryBuilder.set).toHaveBeenCalledWith({
        status: 'running',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        lockedAt: expect.any(Date),
        lockedBy: workerId,
      });
    });
  });

  describe('markSucceeded', () => {
    it('should update job status to succeeded with outcome=ok and clear lock', async () => {
      const jobId = randomUUID();

      ormRepository.update.mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] });

      await repository.markSucceeded(jobId, 'ok');

      expect(ormRepository.update).toHaveBeenCalledWith(jobId, {
        status: 'succeeded',
        outcome: 'ok',
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      });
    });

    it('should persist outcome=business_failure when handler reports a terminal business rejection', async () => {
      const jobId = randomUUID();

      ormRepository.update.mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] });

      await repository.markSucceeded(jobId, 'business_failure');

      expect(ormRepository.update).toHaveBeenCalledWith(jobId, {
        status: 'succeeded',
        outcome: 'business_failure',
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      });
    });
  });

  describe('markFailed', () => {
    it('should update job status to queued for retry with incremented attempts', async () => {
      const jobId = randomUUID();
      const errorMessage = 'Test error message';
      const nextRunAt = new Date(Date.now() + 30000); // 30 seconds from now

      const existingJob = createMockOrmEntity({
        id: jobId,
        attempts: 2,
        status: 'running',
      });

      ormRepository.findOne.mockResolvedValueOnce(existingJob);
      ormRepository.update.mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] });

      await repository.markFailed(jobId, errorMessage, nextRunAt);

      expect(ormRepository.findOne).toHaveBeenCalledWith({ where: { id: jobId } });
      expect(ormRepository.update).toHaveBeenCalledWith(jobId, {
        status: 'queued', // Requeued for retry
        attempts: 3, // Incremented
        nextRunAt,
        lockedAt: null,
        lockedBy: null,
        lastError: errorMessage,
      });
    });

    it('should throw error if job not found', async () => {
      const jobId = randomUUID();
      const errorMessage = 'Test error';
      const nextRunAt = new Date();

      ormRepository.findOne.mockResolvedValueOnce(null);

      await expect(repository.markFailed(jobId, errorMessage, nextRunAt)).rejects.toThrow(
        `Job not found: ${jobId}`
      );
    });

    it('should truncate error message if longer than 1000 characters', async () => {
      const jobId = randomUUID();
      const longErrorMessage = 'x'.repeat(2000);
      const nextRunAt = new Date();

      const existingJob = createMockOrmEntity({
        id: jobId,
        attempts: 1,
      });

      ormRepository.findOne.mockResolvedValueOnce(existingJob);
      ormRepository.update.mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] });

      await repository.markFailed(jobId, longErrorMessage, nextRunAt);

      expect(ormRepository.update).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({
          lastError: 'x'.repeat(1000), // Truncated
        })
      );
    });
  });

  describe('markDead', () => {
    it('should update job status to dead and clear lock', async () => {
      const jobId = randomUUID();
      const errorMessage = 'Max attempts reached';

      ormRepository.update.mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] });

      await repository.markDead(jobId, errorMessage);

      expect(ormRepository.update).toHaveBeenCalledWith(jobId, {
        status: 'dead',
        lockedAt: null,
        lockedBy: null,
        lastError: errorMessage,
      });
    });

    it('should truncate error message if longer than 1000 characters', async () => {
      const jobId = randomUUID();
      const longErrorMessage = 'x'.repeat(2000);

      ormRepository.update.mockResolvedValue({ affected: 1, generatedMaps: [], raw: [] });

      await repository.markDead(jobId, longErrorMessage);

      expect(ormRepository.update).toHaveBeenCalledWith(
        jobId,
        expect.objectContaining({
          lastError: 'x'.repeat(1000), // Truncated
        })
      );
    });
  });

  describe('requeueStuckJobs', () => {
    it('should requeue jobs stuck in running status longer than timeout', async () => {
      const lockTimeoutMinutes = 15;

      const updateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 3 }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock: explicit any narrows the dynamic spy / fixture shape
      ormRepository.createQueryBuilder.mockReturnValue(updateQueryBuilder as any);

      const result = await repository.requeueStuckJobs(lockTimeoutMinutes);

      expect(ormRepository.createQueryBuilder).toHaveBeenCalled();
      expect(updateQueryBuilder.update).toHaveBeenCalledWith(SyncJobOrmEntity);
      expect(updateQueryBuilder.set).toHaveBeenCalledWith({
        status: 'queued',
        lockedAt: null,
        lockedBy: null,
      });
      expect(updateQueryBuilder.where).toHaveBeenCalledWith('status = :status', {
        status: 'running',
      });
      expect(updateQueryBuilder.andWhere).toHaveBeenCalledWith(
        '"lockedAt" < :threshold',
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
          threshold: expect.any(Date),
        })
      );
      expect(result).toBe(3);
    });

    it('should return 0 when no stuck jobs found', async () => {
      const lockTimeoutMinutes = 15;

      const updateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock: explicit any narrows the dynamic spy / fixture shape
      ormRepository.createQueryBuilder.mockReturnValue(updateQueryBuilder as any);

      const result = await repository.requeueStuckJobs(lockTimeoutMinutes);

      expect(result).toBe(0);
    });

    it('should calculate threshold correctly based on timeout', async () => {
      const lockTimeoutMinutes = 30;
      const beforeCall = new Date();

      const updateQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock: explicit any narrows the dynamic spy / fixture shape
      ormRepository.createQueryBuilder.mockReturnValue(updateQueryBuilder as any);

      await repository.requeueStuckJobs(lockTimeoutMinutes);

      const afterCall = new Date();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const threshold = (updateQueryBuilder.andWhere.mock.calls[0][1] as { threshold: Date })
        .threshold;

      // Threshold should be approximately 30 minutes ago (within 1 second tolerance)
      const expectedThreshold = new Date(beforeCall.getTime() - lockTimeoutMinutes * 60 * 1000);
      expect(threshold.getTime()).toBeGreaterThanOrEqual(expectedThreshold.getTime() - 1000);
      expect(threshold.getTime()).toBeLessThanOrEqual(
        afterCall.getTime() - lockTimeoutMinutes * 60 * 1000 + 1000
      );
    });
  });

  describe('toDomain', () => {
    it('should convert ORM entity to domain entity', () => {
      const ormEntity = createMockOrmEntity({
        id: randomUUID(),
        jobType: 'master.product.syncByExternalId',
        connectionId: randomUUID(),
        payloadJson: { externalId: '1' },
        status: 'queued',
        idempotencyKey: 'test-key',
        attempts: 0,
        maxAttempts: 10,
        nextRunAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Access private method via reflection (for testing)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (repository as any).toDomain(ormEntity);

      expect(result).toBeInstanceOf(SyncJob);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(result.id).toBe(ormEntity.id);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(result.jobType).toBe(ormEntity.jobType);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(result.status).toBe(ormEntity.status);
    });

    it('should throw error for invalid job type', () => {
      const ormEntity = createMockOrmEntity({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- test mock: explicit any narrows the dynamic spy / fixture shape
        jobType: 'invalid.job.type' as any,
        status: 'queued',
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- test mock: explicit any narrows the dynamic spy / fixture shape
      expect(() => (repository as any).toDomain(ormEntity)).toThrow('Invalid sync job jobType');
    });

    it('should throw error for invalid job status', () => {
      const ormEntity = createMockOrmEntity({
        jobType: 'master.product.syncByExternalId',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- test mock: explicit any narrows the dynamic spy / fixture shape
        status: 'invalid-status' as any,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- test mock: explicit any narrows the dynamic spy / fixture shape
      expect(() => (repository as any).toDomain(ormEntity)).toThrow('Invalid sync job status');
    });
  });
});

/**
 * Helper function to create mock ORM entity
 */
function createMockOrmEntity(overrides?: Partial<SyncJobOrmEntity>): SyncJobOrmEntity {
  const now = new Date();
  return {
    id: randomUUID(),
    jobType: 'master.product.syncByExternalId',
    connectionId: randomUUID(),
    payloadJson: {},
    status: 'queued',
    idempotencyKey: `test-key-${randomUUID()}`,
    attempts: 0,
    maxAttempts: 10,
    nextRunAt: now,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as SyncJobOrmEntity;
}
