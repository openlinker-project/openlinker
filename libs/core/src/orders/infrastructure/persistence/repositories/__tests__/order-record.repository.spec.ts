/**
 * Order Record Repository Unit Tests
 *
 * Unit tests for OrderRecordRepository, verifying order record persistence operations,
 * sync status updates, and entity conversion.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { OrderRecordRepository } from '../order-record.repository';
import type { OrderSyncStatusJson } from '../../entities/order-record.orm-entity';
import { OrderRecordOrmEntity } from '../../entities/order-record.orm-entity';
import { OrderRecord } from '../../../../domain/entities/order-record.entity';
import type { OrderSyncStatus, SyncAttempt } from '../../../../domain/types/order-sync.types';
import { OrderRecordNotFoundException } from '../../../../domain/exceptions/order-record-not-found.exception';

describe('OrderRecordRepository', () => {
  let repository: OrderRecordRepository;
  let ormRepository: jest.Mocked<Repository<OrderRecordOrmEntity>>;
  let transactionalManager: { save: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    transactionalManager = {
      save: jest.fn(),
      delete: jest.fn(),
    };

    const mockOrmRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      query: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      manager: {
        connection: {
          transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) =>
            cb(transactionalManager)
          ),
        },
      },
    } as unknown as jest.Mocked<Repository<OrderRecordOrmEntity>> & { _qb: typeof qb };

    (mockOrmRepository as unknown as { _qb: typeof qb })._qb = qb;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderRecordRepository,
        {
          provide: getRepositoryToken(OrderRecordOrmEntity),
          useValue: mockOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<OrderRecordRepository>(OrderRecordRepository);
    ormRepository = module.get(getRepositoryToken(OrderRecordOrmEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createOrmEntity = (): OrderRecordOrmEntity => {
    const entity = new OrderRecordOrmEntity();
    entity.internalOrderId = 'order-123';
    entity.customerId = 'customer-456';
    entity.sourceConnectionId = 'source-connection-123';
    entity.sourceEventId = 'event-456';
    entity.orderSnapshot = {
      id: 'order-123',
      orderNumber: 'ORD-001',
      status: 'pending',
    };
    entity.syncStatus = [];
    entity.syncAttempts = [];
    entity.recordStatus = 'ready';
    entity.createdAt = new Date('2025-01-01T10:00:00Z');
    entity.updatedAt = new Date('2025-01-01T10:00:00Z');
    return entity;
  };

  const createDomainEntity = (): OrderRecord => {
    return new OrderRecord(
      'order-123',
      'customer-456',
      'source-connection-123',
      'event-456',
      {
        id: 'order-123',
        orderNumber: 'ORD-001',
        status: 'pending',
      },
      [],
      'ready',
      new Date('2025-01-01T10:00:00Z'),
      new Date('2025-01-01T10:00:00Z')
    );
  };

  describe('findById', () => {
    it('should return order record when found', async () => {
      const entity = createOrmEntity();
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findById('order-123');

      expect(result).toBeDefined();
      expect(result?.internalOrderId).toBe('order-123');
      expect(result?.customerId).toBe('customer-456');
      expect(result?.sourceConnectionId).toBe('source-connection-123');
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { internalOrderId: 'order-123' },
      });
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent-order');

      expect(result).toBeNull();
    });

    it('should convert sync status from JSONB to domain entities', async () => {
      const entity = createOrmEntity();
      const syncStatusJson: OrderSyncStatusJson[] = [
        {
          destinationConnectionId: 'dest-connection-789',
          status: 'synced',
          syncedAt: '2025-01-01T11:00:00Z',
          externalOrderId: 'external-order-999',
          externalOrderNumber: 'EXT-001',
        },
      ];
      entity.syncStatus = syncStatusJson;
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findById('order-123');

      expect(result).toBeDefined();
      expect(result?.syncStatus).toHaveLength(1);
      expect(result?.syncStatus[0].destinationConnectionId).toBe('dest-connection-789');
      expect(result?.syncStatus[0].status).toBe('synced');
      expect(result?.syncStatus[0].syncedAt).toEqual(new Date('2025-01-01T11:00:00Z'));
      expect(result?.syncStatus[0].externalOrderId).toBe('external-order-999');
    });
  });

  describe('findByIds', () => {
    it('should return [] without querying when given an empty array', async () => {
      const result = await repository.findByIds([]);

      expect(result).toEqual([]);
      expect(ormRepository.find).not.toHaveBeenCalled();
    });

    it('should return matching domain entities for a batch of ids', async () => {
      const entity = createOrmEntity();
      ormRepository.find.mockResolvedValue([entity]);

      const result = await repository.findByIds(['order-123', 'non-existent-order']);

      expect(result).toHaveLength(1);
      expect(result[0].internalOrderId).toBe('order-123');
      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { internalOrderId: expect.anything() },
      });
    });

    it('should silently omit ids with no matching row', async () => {
      ormRepository.find.mockResolvedValue([]);

      const result = await repository.findByIds(['missing-1', 'missing-2']);

      expect(result).toEqual([]);
    });
  });

  describe('findEarliestPlacedAtByConnection (#2083)', () => {
    it('should return an empty Map without querying when given an empty array', async () => {
      const result = await repository.findEarliestPlacedAtByConnection([]);

      expect(result).toEqual(new Map());
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should return one Map entry per connection with the correct MIN', async () => {
      const earliestA = new Date('2026-01-01T00:00:00.000Z');
      const earliestB = new Date('2026-02-15T00:00:00.000Z');
      const where = jest.fn().mockReturnThis();
      const groupBy = jest.fn().mockReturnThis();
      const addSelect = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect,
        where,
        groupBy,
        getRawMany: jest.fn().mockResolvedValue([
          { source_connection_id: 'conn-a', earliest_at: earliestA },
          { source_connection_id: 'conn-b', earliest_at: earliestB },
        ]),
      });

      const result = await repository.findEarliestPlacedAtByConnection(['conn-a', 'conn-b']);

      expect(result.get('conn-a')).toEqual(earliestA);
      expect(result.get('conn-b')).toEqual(earliestB);
      expect(where).toHaveBeenCalledWith('rec.sourceConnectionId IN (:...connectionIds)', {
        connectionIds: ['conn-a', 'conn-b'],
      });
      expect(groupBy).toHaveBeenCalledWith('rec.sourceConnectionId');
      expect(addSelect).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(rec."placedAt", rec."createdAt")'),
        'earliest_at'
      );
    });

    it('should omit a connection with zero matching rows from the returned Map', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const result = await repository.findEarliestPlacedAtByConnection(['conn-with-no-orders']);

      expect(result.has('conn-with-no-orders')).toBe(false);
      expect(result.size).toBe(0);
    });
  });

  describe('upsert', () => {
    it('should create new order record', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.upsert(domainEntity);

      expect(result).toBeDefined();
      expect(result.internalOrderId).toBe('order-123');
      expect(ormRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should update existing order record', async () => {
      const domainEntity = createDomainEntity();
      const existingEntity = createOrmEntity();
      existingEntity.updatedAt = new Date('2025-01-02T10:00:00Z');
      ormRepository.save.mockResolvedValue(existingEntity);

      const result = await repository.upsert(domainEntity);

      expect(result).toBeDefined();
      expect(ormRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should convert sync status from domain entities to JSONB', async () => {
      const syncStatus: OrderSyncStatus[] = [
        {
          destinationConnectionId: 'dest-connection-789',
          status: 'synced',
          syncedAt: new Date('2025-01-01T11:00:00Z'),
          externalOrderId: 'external-order-999',
          externalOrderNumber: 'EXT-001',
        },
      ];
      const domainEntity = new OrderRecord(
        'order-123',
        'customer-456',
        'source-connection-123',
        'event-456',
        {
          id: 'order-123',
          orderNumber: 'ORD-001',
          status: 'pending',
        },
        syncStatus,
        'ready',
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T10:00:00Z')
      );
      const savedEntity = createOrmEntity();
      ormRepository.save.mockResolvedValue(savedEntity);

      await repository.upsert(domainEntity);

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.syncStatus).toHaveLength(1);
      expect(callArg.syncStatus[0].destinationConnectionId).toBe('dest-connection-789');
      expect(callArg.syncStatus[0].status).toBe('synced');
      expect(callArg.syncStatus[0].syncedAt).toBe('2025-01-01T11:00:00.000Z');
    });

    it('should map recordStatus to ORM entity on toOrm path', async () => {
      const domainEntity = new OrderRecord(
        'order-123',
        null,
        'conn-123',
        null,
        {},
        [],
        'awaiting_mapping',
        new Date(),
        new Date()
      );
      const savedEntity = createOrmEntity();
      ormRepository.save.mockResolvedValue(savedEntity);

      await repository.upsert(domainEntity);

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.recordStatus).toBe('awaiting_mapping');
    });

    it('should read cancelledAt back via toDomain when present on the ORM row', async () => {
      const cancelledAt = new Date('2026-08-01T12:00:00Z');
      const savedEntity = createOrmEntity();
      savedEntity.cancelledAt = cancelledAt;
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.upsert(createDomainEntity());

      expect(result.cancelledAt).toBe(cancelledAt);
    });

    it('should NOT include cancelledAt in the entity passed to save() (#1984)', async () => {
      // upsert() is a full-object save() with no per-order lock around it, so
      // writing cancelledAt here would race with the atomic, COALESCE-based
      // markCancelled() a concurrent cancel-event call may commit at the same
      // time. Leaving the property unset lets TypeORM omit the column from
      // the generated UPDATE entirely — markCancelled is the sole writer.
      const domainEntity = createDomainEntity();
      ormRepository.save.mockResolvedValue(createOrmEntity());

      await repository.upsert(domainEntity);

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.cancelledAt).toBeUndefined();
    });
  });

  describe('upsertWithLineItems (#1985)', () => {
    it('saves the order record and inserts the derived line items in one transaction', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      transactionalManager.save.mockResolvedValue(savedEntity);
      transactionalManager.delete.mockResolvedValue(undefined);

      const result = await repository.upsertWithLineItems(domainEntity, [
        {
          lineNumber: 0,
          productId: 'ol_product_1',
          variantId: 'ol_variant_1',
          quantity: 2,
          unitPrice: 10,
          sourceConnectionId: 'conn-123',
          placedAt: null,
        },
      ]);

      expect(result.internalOrderId).toBe('order-123');
      // save() is called twice inside the transaction: once for the order
      // record, once for the line-item batch — both on the SAME manager.
      expect(transactionalManager.save).toHaveBeenCalledTimes(2);
      expect(transactionalManager.delete).toHaveBeenCalledWith(expect.anything(), {
        orderRecordId: 'order-123',
      });
    });

    it('deletes the prior line-item set even when the new set is empty (order re-ingested with no items)', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      transactionalManager.save.mockResolvedValue(savedEntity);
      transactionalManager.delete.mockResolvedValue(undefined);

      await repository.upsertWithLineItems(domainEntity, []);

      expect(transactionalManager.delete).toHaveBeenCalledWith(expect.anything(), {
        orderRecordId: 'order-123',
      });
      // Only the order-record save runs — no line-item save call for an empty set.
      expect(transactionalManager.save).toHaveBeenCalledTimes(1);
    });

    it('propagates a failure from either write so the caller sees the transaction as failed', async () => {
      const domainEntity = createDomainEntity();
      transactionalManager.save.mockRejectedValue(new Error('db error'));

      await expect(repository.upsertWithLineItems(domainEntity, [])).rejects.toThrow('db error');
    });
  });

  describe('findMany', () => {
    it('should return all records when no recordStatus filter is provided', async () => {
      const entity = createOrmEntity();
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[entity], 1]),
      });

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      const calls = andWhere.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls.some((c) => c.includes('recordStatus'))).toBe(false);
    });

    it('should add recordStatus WHERE clause when filter is provided', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findMany({ recordStatus: 'awaiting_mapping' }, { limit: 20, offset: 0 });

      expect(andWhere).toHaveBeenCalledWith('rec.recordStatus = :recordStatus', {
        recordStatus: 'awaiting_mapping',
      });
    });

    it('should add cancelledAt IS NOT NULL when cancelled=true (#1984)', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findMany({ cancelled: true }, { limit: 20, offset: 0 });

      expect(andWhere).toHaveBeenCalledWith('rec.cancelledAt IS NOT NULL');
    });

    it('should add cancelledAt IS NULL when cancelled=false (#1984)', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findMany({ cancelled: false }, { limit: 20, offset: 0 });

      expect(andWhere).toHaveBeenCalledWith('rec.cancelledAt IS NULL');
    });
  });

  describe('updateSyncStatus', () => {
    // The current-state upsert + per-destination append + cap is implemented
    // as a single SQL statement and is covered end-to-end by the integration
    // test in apps/api/test/integration/order-record-attempts.int-spec.ts.
    // The unit test here only guards the not-found branch — the only path the
    // integration test can't cheaply express.
    it('should map recordStatus from ORM to domain on toDomain path', async () => {
      const entity = createOrmEntity();
      entity.recordStatus = 'awaiting_mapping';
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findById('order-123');

      expect(result?.recordStatus).toBe('awaiting_mapping');
    });

    it('should throw OrderRecordNotFoundException when no row matches', async () => {
      // pg drivers return [rows, affected] from raw UPDATE; TypeORM forwards.
      (ormRepository.query as jest.Mock).mockResolvedValue([[], 0]);

      const newStatus: OrderSyncStatus = {
        destinationConnectionId: 'dest-connection-789',
        status: 'synced',
      };
      const newAttempt: SyncAttempt = {
        destinationConnectionId: 'dest-connection-789',
        status: 'synced',
        attemptedAt: new Date('2025-01-01T11:00:00Z'),
      };

      await expect(
        repository.updateSyncStatus(
          'non-existent-order',
          'dest-connection-789',
          newStatus,
          newAttempt
        )
      ).rejects.toThrow(OrderRecordNotFoundException);
    });
  });

  describe('markCancelled (#1984)', () => {
    it('should issue a COALESCE update carrying the given instant and order id', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([[], 1]);
      const cancelledAt = new Date('2026-08-11T09:00:00Z');

      await repository.markCancelled('order-123', cancelledAt);

      expect(ormRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE("cancelledAt", $1)'),
        [cancelledAt, 'order-123']
      );
    });

    it('should not throw when no row matches the given order id', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([[], 0]);

      await expect(
        repository.markCancelled('non-existent-order', new Date())
      ).resolves.toBeUndefined();
    });
  });
});
