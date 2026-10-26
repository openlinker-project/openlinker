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
import { QueryFailedError } from 'typeorm';
import type { Repository, UpdateResult } from 'typeorm';

import { BulkListingBatchRepository } from './bulk-listing-batch.repository';
import { BulkListingBatchOrmEntity } from '../entities/bulk-listing-batch.orm-entity';
import { BulkListingBatch } from '../../../domain/entities/bulk-listing-batch.entity';
import { BulkListingBatchNotFoundException } from '../../../domain/exceptions/bulk-listing-batch-not-found.exception';
import { DuplicateBulkBatchIdempotencyKeyError } from '../../../domain/exceptions/duplicate-bulk-batch-idempotency-key.error';
import type { CreateBulkListingBatchInput } from '../../../domain/types/bulk-listing-batch.types';

describe('BulkListingBatchRepository', () => {
  let repository: BulkListingBatchRepository;
  let ormRepository: jest.Mocked<Repository<BulkListingBatchOrmEntity>>;

  const now = new Date('2026-05-17T10:00:00Z');

  const buildOrm = (
    overrides: Partial<BulkListingBatchOrmEntity> = {},
  ): BulkListingBatchOrmEntity => ({
    id: 'batch-uuid',
    connectionId: 'conn-uuid',
    initiatedBy: 'user-1',
    status: 'pending',
    totalCount: 10,
    succeededCount: 0,
    failedCount: 0,
    sharedConfig: { publishImmediately: true },
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  const uniqueViolation = (constraint: string): QueryFailedError =>
    new QueryFailedError('INSERT INTO "bulk_offer_creation_batches"', [], {
      code: '23505',
      constraint,
    } as unknown as Error);

  const buildUpdateResult = (affected: number): UpdateResult =>
    ({ affected, raw: [], generatedMaps: [] }) as UpdateResult;

  /**
   * A chainable stand-in for `createQueryBuilder().update().set().where()
   * .setParameters().execute()`, recording what the counter UPDATE was built
   * from so a spec can assert it is ONE statement carrying every delta.
   */
  type CounterBuilder = {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    setParameters: jest.Mock;
    execute: jest.Mock;
  };
  const buildCounterBuilder = (affected: number): CounterBuilder => {
    const builder = {} as CounterBuilder;
    builder.update = jest.fn().mockReturnValue(builder);
    builder.set = jest.fn().mockReturnValue(builder);
    builder.where = jest.fn().mockReturnValue(builder);
    builder.setParameters = jest.fn().mockReturnValue(builder);
    builder.execute = jest.fn().mockResolvedValue(buildUpdateResult(affected));
    return builder;
  };
  /** Renders each raw setter the builder received, e.g. `"failedCount" + :failedDelta`. */
  const renderedSetters = (builder: CounterBuilder): Record<string, string> => {
    const set = builder.set.mock.calls[0][0] as Record<string, () => string>;
    return Object.fromEntries(Object.entries(set).map(([column, fn]) => [column, fn()]));
  };

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn(),
      update: jest.fn(),
      manager: { transaction: jest.fn() },
    } as unknown as jest.Mocked<Repository<BulkListingBatchOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BulkListingBatchRepository,
        {
          provide: getRepositoryToken(BulkListingBatchOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<BulkListingBatchRepository>(BulkListingBatchRepository);
    ormRepository = module.get(getRepositoryToken(BulkListingBatchOrmEntity));
  });

  describe('create', () => {
    it('should persist a new batch with defaults and return a domain entity', async () => {
      const input: CreateBulkListingBatchInput = {
        connectionId: 'conn-uuid',
        initiatedBy: 'user-1',
        totalCount: 10,
        sharedConfig: { publishImmediately: true },
      };
      ormRepository.save.mockResolvedValue(buildOrm());

      const result = await repository.create(input);

      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      const savedArg = ormRepository.save.mock.calls[0][0] as BulkListingBatchOrmEntity;
      expect(savedArg.connectionId).toBe('conn-uuid');
      expect(savedArg.initiatedBy).toBe('user-1');
      expect(savedArg.totalCount).toBe(10);
      expect(savedArg.status).toBe('pending');
      expect(savedArg.succeededCount).toBe(0);
      expect(savedArg.failedCount).toBe(0);
      expect(savedArg.sharedConfig).toEqual({ publishImmediately: true });

      expect(result).toBeInstanceOf(BulkListingBatch);
      expect(result.id).toBe('batch-uuid');
      expect(result.status).toBe('pending');
      expect(result.succeededCount).toBe(0);
      expect(result.failedCount).toBe(0);
    });

    it('should accept an empty sharedConfig object', async () => {
      const input: CreateBulkListingBatchInput = {
        connectionId: 'conn-uuid',
        initiatedBy: 'user-1',
        totalCount: 5,
        sharedConfig: {},
      };
      ormRepository.save.mockResolvedValue(buildOrm({ totalCount: 5, sharedConfig: {} }));

      const result = await repository.create(input);

      const savedArg = ormRepository.save.mock.calls[0][0] as BulkListingBatchOrmEntity;
      expect(savedArg.sharedConfig).toEqual({});
      expect(result.sharedConfig).toEqual({});
    });
  });

  describe('create with an idempotency key', () => {
    const input: CreateBulkListingBatchInput = {
      connectionId: 'conn-uuid',
      initiatedBy: 'user-1',
      totalCount: 2,
      sharedConfig: {},
      idempotencyKey: 'key-1',
    };

    it('should persist the key on the row and map it back onto the domain entity', async () => {
      ormRepository.save.mockResolvedValue(buildOrm({ idempotencyKey: 'key-1' }));

      const result = await repository.create(input);

      const savedArg = ormRepository.save.mock.calls[0][0] as BulkListingBatchOrmEntity;
      expect(savedArg.idempotencyKey).toBe('key-1');
      expect(result.idempotencyKey).toBe('key-1');
    });

    it('should store null when no key is given', async () => {
      ormRepository.save.mockResolvedValue(buildOrm());

      const result = await repository.create({ ...input, idempotencyKey: undefined });

      const savedArg = ormRepository.save.mock.calls[0][0] as BulkListingBatchOrmEntity;
      expect(savedArg.idempotencyKey).toBeNull();
      expect(result.idempotencyKey).toBeNull();
    });

    it('should translate a unique violation on the key index into the domain error', async () => {
      ormRepository.save.mockRejectedValue(
        uniqueViolation('UQ_bulk_offer_creation_batches_connection_idempotency_key'),
      );

      const error: unknown = await repository.create(input).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(DuplicateBulkBatchIdempotencyKeyError);
      expect(error).toMatchObject({ connectionId: 'conn-uuid', idempotencyKey: 'key-1' });
    });

    it('should rethrow a unique violation on a different constraint unchanged', async () => {
      const pkViolation = uniqueViolation('PK_bulk_offer_creation_batches');
      ormRepository.save.mockRejectedValue(pkViolation);

      await expect(repository.create(input)).rejects.toBe(pkViolation);
    });

    it('should rethrow the key-index violation unchanged when the input carried no key', async () => {
      const violation = uniqueViolation('UQ_bulk_offer_creation_batches_connection_idempotency_key');
      ormRepository.save.mockRejectedValue(violation);

      await expect(repository.create({ ...input, idempotencyKey: null })).rejects.toBe(violation);
    });
  });

  describe('findByIdempotencyKey', () => {
    it('should look the batch up by connection and key', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm({ idempotencyKey: 'key-1' }));

      const result = await repository.findByIdempotencyKey('conn-uuid', 'key-1');

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { connectionId: 'conn-uuid', idempotencyKey: 'key-1' },
      });
      expect(result?.id).toBe('batch-uuid');
    });

    it('should return null when no batch holds the key', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.findByIdempotencyKey('conn-uuid', 'key-1')).resolves.toBeNull();
    });
  });

  describe('clearIdempotencyKey', () => {
    it('should null the key on the row', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));

      await repository.clearIdempotencyKey('batch-uuid');

      expect(ormRepository.update).toHaveBeenCalledWith(
        { id: 'batch-uuid' },
        { idempotencyKey: null },
      );
    });
  });

  describe('findById', () => {
    it('should return domain entity when found', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.findById('batch-uuid');

      expect(ormRepository.findOne).toHaveBeenCalledWith({ where: { id: 'batch-uuid' } });
      expect(result).toBeInstanceOf(BulkListingBatch);
      expect(result?.id).toBe('batch-uuid');
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('missing');

      expect(result).toBeNull();
    });
  });

  describe('incrementCounters', () => {
    it('should apply a succeeded delta as one bound-parameter UPDATE', async () => {
      const builder = buildCounterBuilder(1);
      ormRepository.createQueryBuilder.mockReturnValue(builder as never);
      ormRepository.findOne.mockResolvedValue(buildOrm({ succeededCount: 1 }));

      const result = await repository.incrementCounters('batch-uuid', { succeeded: 1 });

      expect(builder.execute).toHaveBeenCalledTimes(1);
      expect(renderedSetters(builder)).toEqual({
        succeededCount: '"succeededCount" + :succeededDelta',
      });
      expect(builder.setParameters).toHaveBeenCalledWith({ id: 'batch-uuid', succeededDelta: 1 });
      expect(result.succeededCount).toBe(1);
    });

    it('should apply a failed delta as one bound-parameter UPDATE', async () => {
      const builder = buildCounterBuilder(1);
      ormRepository.createQueryBuilder.mockReturnValue(builder as never);
      ormRepository.findOne.mockResolvedValue(buildOrm({ failedCount: 3 }));

      const result = await repository.incrementCounters('batch-uuid', { failed: 3 });

      expect(renderedSetters(builder)).toEqual({ failedCount: '"failedCount" + :failedDelta' });
      expect(builder.setParameters).toHaveBeenCalledWith({ id: 'batch-uuid', failedDelta: 3 });
      expect(result.failedCount).toBe(3);
    });

    it('should move both counters in ONE statement so no half-applied move is ever observable', async () => {
      const builder = buildCounterBuilder(1);
      ormRepository.createQueryBuilder.mockReturnValue(builder as never);
      ormRepository.findOne.mockResolvedValue(buildOrm({ succeededCount: 0, failedCount: 1 }));

      await repository.incrementCounters('batch-uuid', { succeeded: -1, failed: 1 });

      expect(ormRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(builder.execute).toHaveBeenCalledTimes(1);
      expect(renderedSetters(builder)).toEqual({
        succeededCount: '"succeededCount" + :succeededDelta',
        failedCount: '"failedCount" + :failedDelta',
      });
      expect(builder.setParameters).toHaveBeenCalledWith({
        id: 'batch-uuid',
        succeededDelta: -1,
        failedDelta: 1,
      });
    });

    it('should short-circuit zero deltas without issuing an UPDATE', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.incrementCounters('batch-uuid', { succeeded: 0, failed: 0 });

      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(result).toBeInstanceOf(BulkListingBatch);
    });

    it('should throw BulkListingBatchNotFoundException when the UPDATE affects no rows', async () => {
      ormRepository.createQueryBuilder.mockReturnValue(buildCounterBuilder(0) as never);

      await expect(
        repository.incrementCounters('missing', { succeeded: 1 }),
      ).rejects.toBeInstanceOf(BulkListingBatchNotFoundException);
      expect(ormRepository.findOne).not.toHaveBeenCalled();
    });

    it('should throw BulkListingBatchNotFoundException when row is deleted between update and read', async () => {
      ormRepository.createQueryBuilder.mockReturnValue(buildCounterBuilder(1) as never);
      ormRepository.findOne.mockResolvedValue(null);

      await expect(
        repository.incrementCounters('batch-uuid', { succeeded: 1 }),
      ).rejects.toBeInstanceOf(BulkListingBatchNotFoundException);
    });
  });

  describe('reclassifySucceededChildAsFailed (E2E-21)', () => {
    /**
     * Wires `manager.transaction` to run its callback against a manager whose
     * repositories are the given stand-ins, the way TypeORM hands the callback
     * a transaction-scoped manager.
     */
    const wireTransaction = (advancementUpdateAffected: number) => {
      const advancementRepo = {
        update: jest.fn().mockResolvedValue(buildUpdateResult(advancementUpdateAffected)),
      };
      const builder = buildCounterBuilder(1);
      const batchRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(builder),
        findOne: jest.fn().mockResolvedValue(buildOrm({ succeededCount: 0, failedCount: 1 })),
      };
      const manager = {
        getRepository: jest.fn((entity: unknown) =>
          entity === BulkListingBatchOrmEntity ? batchRepo : advancementRepo
        ),
      };
      const transaction = ormRepository.manager.transaction as unknown as jest.Mock;
      transaction.mockImplementation((run: (m: typeof manager) => Promise<unknown>) => run(manager));
      return { advancementRepo, batchRepo, builder, transaction };
    };

    it('should flip the gate and move both counters inside one transaction', async () => {
      const { advancementRepo, batchRepo, builder, transaction } = wireTransaction(1);

      const result = await repository.reclassifySucceededChildAsFailed('batch-uuid', 'rec-1');

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(advancementRepo.update).toHaveBeenCalledWith(
        { bulkBatchId: 'batch-uuid', offerCreationRecordId: 'rec-1', outcome: 'succeeded' },
        { outcome: 'failed' },
      );
      // The counters move on the TRANSACTION's repository, not the injected one.
      expect(batchRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(builder.setParameters).toHaveBeenCalledWith({
        id: 'batch-uuid',
        succeededDelta: -1,
        failedDelta: 1,
      });
      expect(result).toMatchObject({ succeededCount: 0, failedCount: 1 });
    });

    it('should leave the counters alone and return null when the gate matches nothing (replay)', async () => {
      const { batchRepo } = wireTransaction(0);

      const result = await repository.reclassifySucceededChildAsFailed('batch-uuid', 'rec-1');

      expect(result).toBeNull();
      expect(batchRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should propagate a missing batch so the transaction rolls the flip back', async () => {
      const { builder } = wireTransaction(1);
      builder.execute.mockResolvedValue(buildUpdateResult(0));

      await expect(
        repository.reclassifySucceededChildAsFailed('batch-uuid', 'rec-1'),
      ).rejects.toBeInstanceOf(BulkListingBatchNotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('should write only the status column and return the re-read entity', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(buildOrm({ status: 'running' }));

      const result = await repository.updateStatus('batch-uuid', 'running');

      expect(ormRepository.update).toHaveBeenCalledWith({ id: 'batch-uuid' }, { status: 'running' });
      // Never a load-then-save: that would write back stale counters.
      expect(ormRepository.save).not.toHaveBeenCalled();
      expect(result.status).toBe('running');
    });

    it('should be idempotent at the same status value', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(buildOrm({ status: 'completed' }));

      const result = await repository.updateStatus('batch-uuid', 'completed');

      expect(ormRepository.update).toHaveBeenCalledWith(
        { id: 'batch-uuid' },
        { status: 'completed' },
      );
      expect(result.status).toBe('completed');
    });

    it('should throw BulkListingBatchNotFoundException when row is missing', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(0));

      await expect(repository.updateStatus('missing', 'running')).rejects.toBeInstanceOf(
        BulkListingBatchNotFoundException,
      );
      expect(ormRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('updateTotalCount', () => {
    it('should write only the totalCount column', async () => {
      ormRepository.update.mockResolvedValue(buildUpdateResult(1));
      ormRepository.findOne.mockResolvedValue(buildOrm({ totalCount: 4 }));

      const result = await repository.updateTotalCount('batch-uuid', 4);

      expect(ormRepository.update).toHaveBeenCalledWith({ id: 'batch-uuid' }, { totalCount: 4 });
      expect(ormRepository.save).not.toHaveBeenCalled();
      expect(result.totalCount).toBe(4);
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
        new BulkListingBatch(
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
