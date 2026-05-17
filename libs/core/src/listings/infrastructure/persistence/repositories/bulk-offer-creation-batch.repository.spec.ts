/**
 * Bulk Offer Creation Batch Repository — Unit Tests
 *
 * Verifies CRUD operations, atomic counter increments, domain mapping, and
 * not-found exception handling. Mocks the TypeORM repository; no Docker.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository, UpdateResult } from 'typeorm';

import { BulkOfferCreationBatchRepository } from './bulk-offer-creation-batch.repository';
import { BulkOfferCreationBatchOrmEntity } from '../entities/bulk-offer-creation-batch.orm-entity';
import { BulkOfferCreationBatch } from '../../../domain/entities/bulk-offer-creation-batch.entity';
import { BulkOfferCreationBatchNotFoundException } from '../../../domain/exceptions/bulk-offer-creation-batch-not-found.exception';
import type { CreateBulkOfferCreationBatchInput } from '../../../domain/types/bulk-offer-creation-batch.types';

describe('BulkOfferCreationBatchRepository', () => {
  let repository: BulkOfferCreationBatchRepository;
  let ormRepository: jest.Mocked<Repository<BulkOfferCreationBatchOrmEntity>>;

  const now = new Date('2026-05-17T10:00:00Z');

  const buildOrm = (
    overrides: Partial<BulkOfferCreationBatchOrmEntity> = {},
  ): BulkOfferCreationBatchOrmEntity => ({
    id: 'batch-uuid',
    connectionId: 'conn-uuid',
    initiatedBy: 'user-1',
    status: 'pending',
    totalCount: 10,
    succeededCount: 0,
    failedCount: 0,
    sharedConfig: { publishImmediately: true },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const buildUpdateResult = (affected: number): UpdateResult =>
    ({ affected, raw: [], generatedMaps: [] }) as UpdateResult;

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      increment: jest.fn(),
    } as unknown as jest.Mocked<Repository<BulkOfferCreationBatchOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkOfferCreationBatchRepository,
        {
          provide: getRepositoryToken(BulkOfferCreationBatchOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<BulkOfferCreationBatchRepository>(BulkOfferCreationBatchRepository);
    ormRepository = module.get(getRepositoryToken(BulkOfferCreationBatchOrmEntity));
  });

  describe('create', () => {
    it('should persist a new batch with defaults and return a domain entity', async () => {
      const input: CreateBulkOfferCreationBatchInput = {
        connectionId: 'conn-uuid',
        initiatedBy: 'user-1',
        totalCount: 10,
        sharedConfig: { publishImmediately: true },
      };
      ormRepository.save.mockResolvedValue(buildOrm());

      const result = await repository.create(input);

      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      const savedArg = ormRepository.save.mock.calls[0][0] as BulkOfferCreationBatchOrmEntity;
      expect(savedArg.connectionId).toBe('conn-uuid');
      expect(savedArg.initiatedBy).toBe('user-1');
      expect(savedArg.totalCount).toBe(10);
      expect(savedArg.status).toBe('pending');
      expect(savedArg.succeededCount).toBe(0);
      expect(savedArg.failedCount).toBe(0);
      expect(savedArg.sharedConfig).toEqual({ publishImmediately: true });

      expect(result).toBeInstanceOf(BulkOfferCreationBatch);
      expect(result.id).toBe('batch-uuid');
      expect(result.status).toBe('pending');
      expect(result.succeededCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it('should accept an empty sharedConfig object', async () => {
      const input: CreateBulkOfferCreationBatchInput = {
        connectionId: 'conn-uuid',
        initiatedBy: 'user-1',
        totalCount: 5,
        sharedConfig: {},
      };
      ormRepository.save.mockResolvedValue(buildOrm({ totalCount: 5, sharedConfig: {} }));

      const result = await repository.create(input);

      const savedArg = ormRepository.save.mock.calls[0][0] as BulkOfferCreationBatchOrmEntity;
      expect(savedArg.sharedConfig).toEqual({});
      expect(result.sharedConfig).toEqual({});
    });
  });

  describe('findById', () => {
    it('should return domain entity when found', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.findById('batch-uuid');

      expect(ormRepository.findOne).toHaveBeenCalledWith({ where: { id: 'batch-uuid' } });
      expect(result).toBeInstanceOf(BulkOfferCreationBatch);
      expect(result?.id).toBe('batch-uuid');
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('incrementCounters', () => {
    it('should increment succeededCount only and short-circuit failed delta', async () => {
      ormRepository.increment.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(buildOrm({ succeededCount: 1 }));

      const result = await repository.incrementCounters('batch-uuid', { succeeded: 1 });

      expect(ormRepository.increment).toHaveBeenCalledTimes(1);
      expect(ormRepository.increment).toHaveBeenCalledWith({ id: 'batch-uuid' }, 'succeededCount', 1);
      expect(result.succeededCount).toBe(1);
    });

    it('should increment failedCount only and short-circuit succeeded delta', async () => {
      ormRepository.increment.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(buildOrm({ failedCount: 3 }));

      const result = await repository.incrementCounters('batch-uuid', { failed: 3 });

      expect(ormRepository.increment).toHaveBeenCalledTimes(1);
      expect(ormRepository.increment).toHaveBeenCalledWith({ id: 'batch-uuid' }, 'failedCount', 3);
      expect(result.failedCount).toBe(3);
    });

    it('should increment both counters in two sequential statements when both deltas non-zero', async () => {
      ormRepository.increment.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(buildOrm({ succeededCount: 1, failedCount: 1 }));

      const result = await repository.incrementCounters('batch-uuid', { succeeded: 1, failed: 1 });

      expect(ormRepository.increment).toHaveBeenCalledTimes(2);
      expect(ormRepository.increment).toHaveBeenNthCalledWith(1, { id: 'batch-uuid' }, 'succeededCount', 1);
      expect(ormRepository.increment).toHaveBeenNthCalledWith(2, { id: 'batch-uuid' }, 'failedCount', 1);
      expect(result.succeededCount).toBe(1);
      expect(result.failedCount).toBe(1);
    });

    it('should short-circuit zero deltas without calling increment', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.incrementCounters('batch-uuid', { succeeded: 0, failed: 0 });

      expect(ormRepository.increment).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(BulkOfferCreationBatch);
    });

    it('should accept negative deltas (compensation flow)', async () => {
      ormRepository.increment.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(buildOrm({ succeededCount: -1 }));

      await repository.incrementCounters('batch-uuid', { succeeded: -1 });

      expect(ormRepository.increment).toHaveBeenCalledWith({ id: 'batch-uuid' }, 'succeededCount', -1);
    });

    it('should throw BulkOfferCreationBatchNotFoundException when increment affects no rows', async () => {
      ormRepository.increment.mockResolvedValue(buildUpdateResult(0));

      await expect(
        repository.incrementCounters('missing', { succeeded: 1 }),
      ).rejects.toBeInstanceOf(BulkOfferCreationBatchNotFoundException);
      expect(ormRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw BulkOfferCreationBatchNotFoundException when row is deleted between increment and read', async () => {
      ormRepository.increment.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(null);

      await expect(
        repository.incrementCounters('batch-uuid', { succeeded: 1 }),
      ).rejects.toBeInstanceOf(BulkOfferCreationBatchNotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('should update status and return the updated domain entity', async () => {
      const existing = buildOrm();
      ormRepository.findOne.mockResolvedValue(existing);
      ormRepository.save.mockResolvedValue(buildOrm({ status: 'running' }));

      const result = await repository.updateStatus('batch-uuid', 'running');

      expect(ormRepository.findOne).toHaveBeenCalledWith({ where: { id: 'batch-uuid' } });
      const savedArg = ormRepository.save.mock.calls[0][0] as BulkOfferCreationBatchOrmEntity;
      expect(savedArg.status).toBe('running');
      expect(result.status).toBe('running');
    });

    it('should be idempotent at the same status value', async () => {
      const existing = buildOrm({ status: 'completed' });
      ormRepository.findOne.mockResolvedValue(existing);
      ormRepository.save.mockResolvedValue(existing);

      const result = await repository.updateStatus('batch-uuid', 'completed');

      const savedArg = ormRepository.save.mock.calls[0][0] as BulkOfferCreationBatchOrmEntity;
      expect(savedArg.status).toBe('completed');
      expect(result.status).toBe('completed');
    });

    it('should throw BulkOfferCreationBatchNotFoundException when row is missing', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.updateStatus('missing', 'running')).rejects.toBeInstanceOf(
        BulkOfferCreationBatchNotFoundException,
      );
      expect(ormRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('toDomain mapping', () => {
    it('should preserve all fields round-trip', async () => {
      const sharedConfig = { publishImmediately: false, shippingRatePackageId: 'pkg-9' };
      ormRepository.findOne.mockResolvedValue(
        buildOrm({
          status: 'partially-failed',
          succeededCount: 7,
          failedCount: 3,
          sharedConfig,
        }),
      );

      const result = await repository.findById('batch-uuid');

      expect(result).toEqual(
        new BulkOfferCreationBatch(
          'batch-uuid',
          'conn-uuid',
          'user-1',
          'partially-failed',
          10,
          7,
          3,
          sharedConfig,
          now,
          now,
        ),
      );
    });
  });
});
