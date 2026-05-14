/**
 * Sync Job Repository Unit Tests
 *
 * Tests for the read methods added to SyncJobRepository:
 * findById and findMany (with filters and pagination).
 *
 * @module libs/core/src/sync/infrastructure/persistence/repositories
 */
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Repository } from 'typeorm';
import { SyncJobRepository } from './sync-job.repository';
import { SyncJobOrmEntity } from '../entities/sync-job.orm-entity';
import { InvalidSyncJobStateError } from '../../../domain/exceptions/invalid-sync-job-state.error';
import { SyncJobNotFoundError } from '../../../domain/exceptions/sync-job-not-found.error';

function makeOrmEntity(overrides: Partial<SyncJobOrmEntity> = {}): SyncJobOrmEntity {
  const e = new SyncJobOrmEntity();
  e.id = 'job-1';
  e.jobType = 'marketplace.orders.poll';
  e.connectionId = 'conn-1';
  e.payloadJson = {};
  e.status = 'queued';
  e.idempotencyKey = 'key-1';
  e.attempts = 0;
  e.maxAttempts = 10;
  e.nextRunAt = new Date('2026-01-01T00:00:00Z');
  e.lockedAt = null;
  e.lockedBy = null;
  e.lastError = null;
  e.createdAt = new Date('2026-01-01T00:00:00Z');
  e.updatedAt = new Date('2026-01-01T00:00:00Z');
  return Object.assign(e, overrides);
}

describe('SyncJobRepository', () => {
  let repo: SyncJobRepository;
  let ormRepo: jest.Mocked<Repository<SyncJobOrmEntity>>;

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: { connection: { transaction: jest.fn() } },
    } as unknown as jest.Mocked<Repository<SyncJobOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncJobRepository,
        {
          provide: getRepositoryToken(SyncJobOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repo = module.get(SyncJobRepository);
    ormRepo = module.get(getRepositoryToken(SyncJobOrmEntity));
  });

  describe('findById', () => {
    it('should return domain entity when job exists', async () => {
      ormRepo.findOne.mockResolvedValue(makeOrmEntity());

      const result = await repo.findById('job-1');

      expect(result).not.toBeNull();
      expect(result?.id).toBe('job-1');
      expect(result?.jobType).toBe('marketplace.orders.poll');
      expect(ormRepo.findOne).toHaveBeenCalledWith({ where: { id: 'job-1' } });
    });

    it('should return null when job does not exist', async () => {
      ormRepo.findOne.mockResolvedValue(null);

      const result = await repo.findById('missing-id');

      expect(result).toBeNull();
    });
  });

  describe('findMany', () => {
    it('should return paginated items and total', async () => {
      const entities = [makeOrmEntity(), makeOrmEntity({ id: 'job-2' })];
      ormRepo.findAndCount.mockResolvedValue([entities, 2]);

      const result = await repo.findMany({}, { limit: 20, offset: 0 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(ormRepo.findAndCount).toHaveBeenCalledWith({
        where: {},
        order: { createdAt: 'DESC' },
        take: 20,
        skip: 0,
      });
    });

    it('should apply status filter', async () => {
      ormRepo.findAndCount.mockResolvedValue([[makeOrmEntity({ status: 'running' })], 1]);

      await repo.findMany({ status: 'running' }, { limit: 10, offset: 0 });

      expect(ormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'running' } })
      );
    });

    it('should apply connectionId filter', async () => {
      ormRepo.findAndCount.mockResolvedValue([[], 0]);

      await repo.findMany({ connectionId: 'conn-abc' }, { limit: 20, offset: 0 });

      expect(ormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { connectionId: 'conn-abc' } })
      );
    });

    it('should apply jobType filter', async () => {
      ormRepo.findAndCount.mockResolvedValue([[], 0]);

      await repo.findMany({ jobType: 'marketplace.offers.sync' }, { limit: 20, offset: 0 });

      expect(ormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { jobType: 'marketplace.offers.sync' } })
      );
    });

    it('should return empty items and total 0 when no results', async () => {
      ormRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await repo.findMany({}, { limit: 20, offset: 0 });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should apply pagination offset', async () => {
      ormRepo.findAndCount.mockResolvedValue([[], 5]);

      await repo.findMany({}, { limit: 2, offset: 4 });

      expect(ormRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 2, skip: 4 })
      );
    });
  });

  describe('requeueDeadJob', () => {
    function mockQueryBuilder(affected: number): void {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
      ormRepo.createQueryBuilder.mockReturnValue(qb as never);
    }

    it('should requeue a dead job to queued status atomically', async () => {
      mockQueryBuilder(1);
      const requeuedEntity = makeOrmEntity({
        id: 'dead-1',
        status: 'queued',
        attempts: 0,
        lastError: 'some error',
      });
      ormRepo.findOne.mockResolvedValue(requeuedEntity);

      const result = await repo.requeueDeadJob('dead-1');

      expect(result.id).toBe('dead-1');
      expect(result.status).toBe('queued');
      expect(ormRepo.createQueryBuilder).toHaveBeenCalled();
    });

    it('should throw SyncJobNotFoundError when job does not exist', async () => {
      mockQueryBuilder(0);
      ormRepo.findOne.mockResolvedValue(null);

      await expect(repo.requeueDeadJob('missing')).rejects.toThrow(SyncJobNotFoundError);
    });

    it('should throw InvalidSyncJobStateError when job is not dead', async () => {
      mockQueryBuilder(0);
      ormRepo.findOne.mockResolvedValue(makeOrmEntity({ status: 'queued' }));

      await expect(repo.requeueDeadJob('job-1')).rejects.toThrow(InvalidSyncJobStateError);
    });
  });
});
