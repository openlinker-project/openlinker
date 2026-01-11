/**
 * Order Record Repository Unit Tests
 *
 * Unit tests for OrderRecordRepository, verifying order record persistence operations,
 * sync status updates, and entity conversion.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderRecordRepository } from '../order-record.repository';
import { OrderRecordOrmEntity, OrderSyncStatusJson } from '../../entities/order-record.orm-entity';
import { OrderRecord, OrderSyncStatus } from '../../../../domain/entities/order-record.entity';
import { OrderRecordNotFoundException } from '../../../../domain/exceptions/order-record-not-found.exception';

describe('OrderRecordRepository', () => {
  let repository: OrderRecordRepository;
  let ormRepository: jest.Mocked<Repository<OrderRecordOrmEntity>>;

  beforeEach(async () => {
    const mockOrmRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    } as unknown as jest.Mocked<Repository<OrderRecordOrmEntity>>;

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
      new Date('2025-01-01T10:00:00Z'),
      new Date('2025-01-01T10:00:00Z'),
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
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T10:00:00Z'),
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
  });

  describe('updateSyncStatus', () => {
    it('should update existing sync status for a destination', async () => {
      const entity = createOrmEntity();
      const existingSyncStatus: OrderSyncStatusJson = {
        destinationConnectionId: 'dest-connection-789',
        status: 'pending',
      };
      entity.syncStatus = [existingSyncStatus];
      ormRepository.findOne.mockResolvedValue(entity);
      ormRepository.save.mockResolvedValue(entity);

      const newStatus: OrderSyncStatus = {
        destinationConnectionId: 'dest-connection-789',
        status: 'synced',
        syncedAt: new Date('2025-01-01T11:00:00Z'),
        externalOrderId: 'external-order-999',
      };

      await repository.updateSyncStatus('order-123', 'dest-connection-789', newStatus);

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { internalOrderId: 'order-123' },
      });
      expect(ormRepository.save).toHaveBeenCalledTimes(1);
      const savedEntity = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(savedEntity.syncStatus).toHaveLength(1);
      expect(savedEntity.syncStatus[0].status).toBe('synced');
    });

    it('should add new sync status if destination not found', async () => {
      const entity = createOrmEntity();
      entity.syncStatus = [];
      ormRepository.findOne.mockResolvedValue(entity);
      ormRepository.save.mockResolvedValue(entity);

      const newStatus: OrderSyncStatus = {
        destinationConnectionId: 'dest-connection-789',
        status: 'synced',
        syncedAt: new Date('2025-01-01T11:00:00Z'),
      };

      await repository.updateSyncStatus('order-123', 'dest-connection-789', newStatus);

      const savedEntity = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(savedEntity.syncStatus).toHaveLength(1);
      expect(savedEntity.syncStatus[0].destinationConnectionId).toBe('dest-connection-789');
    });

    it('should throw OrderRecordNotFoundException if order record not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const newStatus: OrderSyncStatus = {
        destinationConnectionId: 'dest-connection-789',
        status: 'synced',
      };

      await expect(
        repository.updateSyncStatus('non-existent-order', 'dest-connection-789', newStatus),
      ).rejects.toThrow(OrderRecordNotFoundException);
      
      try {
        await repository.updateSyncStatus('non-existent-order', 'dest-connection-789', newStatus);
      } catch (error) {
        expect(error).toBeInstanceOf(OrderRecordNotFoundException);
        expect((error as OrderRecordNotFoundException).internalOrderId).toBe('non-existent-order');
      }
    });
  });
});
