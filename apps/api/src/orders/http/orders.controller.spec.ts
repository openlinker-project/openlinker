/**
 * Orders Controller Unit Tests
 *
 * @module apps/api/src/orders/http
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  OrderRecord,
} from '@openlinker/core/orders';
import type { OrderRecordRepositoryPort } from '@openlinker/core/orders';

describe('OrdersController', () => {
  let controller: OrdersController;
  let repository: jest.Mocked<OrderRecordRepositoryPort>;

  const mockOrder = new OrderRecord(
    'ol_order_001',
    'ol_customer_001',
    'conn-source-001',
    'event-001',
    { externalOrderId: 'EXT-123', items: [] },
    [
      {
        destinationConnectionId: 'conn-dest-001',
        status: 'synced',
        syncedAt: new Date('2026-04-01T12:00:00Z'),
        externalOrderId: 'PS-456',
        externalOrderNumber: '000456',
      },
    ],
    new Date('2026-04-01T00:00:00Z'),
    new Date('2026-04-01T12:00:00Z'),
  );

  beforeEach(async () => {
    const mockRepository: jest.Mocked<OrderRecordRepositoryPort> = {
      findById: jest.fn(),
      upsert: jest.fn(),
      updateSyncStatus: jest.fn(),
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: ORDER_RECORD_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
    repository = module.get(ORDER_RECORD_REPOSITORY_TOKEN);
  });

  describe('listOrders', () => {
    it('should return paginated order records', async () => {
      repository.findMany.mockResolvedValue({ items: [mockOrder], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(result.items[0].internalOrderId).toBe('ol_order_001');
      expect(result.items[0].syncStatus).toHaveLength(1);
      expect(result.items[0].syncStatus[0].status).toBe('synced');
      expect(result.items[0].syncStatus[0].externalOrderId).toBe('PS-456');
    });

    it('should pass filters to repository', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listOrders({
        sourceConnectionId: 'conn-001',
        syncStatus: 'failed',
        customerId: 'cust-001',
        createdFrom: '2026-01-01T00:00:00Z',
        createdTo: '2026-12-31T23:59:59Z',
        limit: 10,
        offset: 5,
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        {
          sourceConnectionId: 'conn-001',
          syncStatus: 'failed',
          customerId: 'cust-001',
          createdFrom: new Date('2026-01-01T00:00:00Z'),
          createdTo: new Date('2026-12-31T23:59:59Z'),
        },
        { limit: 10, offset: 5 },
      );
    });

    it('should return empty list when no orders match', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('should serialize dates as ISO strings', async () => {
      repository.findMany.mockResolvedValue({ items: [mockOrder], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items[0].createdAt).toBe('2026-04-01T00:00:00.000Z');
      expect(result.items[0].updatedAt).toBe('2026-04-01T12:00:00.000Z');
      expect(result.items[0].syncStatus[0].syncedAt).toBe('2026-04-01T12:00:00.000Z');
    });

    it('should handle sync status with undefined optional fields', async () => {
      const orderWithMinimalSync = new OrderRecord(
        'ol_order_002',
        null,
        'conn-source-001',
        null,
        {},
        [{ destinationConnectionId: 'conn-dest-001', status: 'pending' }],
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-01T00:00:00Z'),
      );
      repository.findMany.mockResolvedValue({ items: [orderWithMinimalSync], total: 1 });

      const result = await controller.listOrders({ limit: 20, offset: 0 });

      expect(result.items[0].syncStatus[0].syncedAt).toBeNull();
      expect(result.items[0].syncStatus[0].externalOrderId).toBeNull();
      expect(result.items[0].syncStatus[0].error).toBeNull();
    });
  });

  describe('getOrder', () => {
    it('should return order record when found', async () => {
      repository.findById.mockResolvedValue(mockOrder);

      const result = await controller.getOrder('ol_order_001');

      expect(result.internalOrderId).toBe('ol_order_001');
      expect(result.customerId).toBe('ol_customer_001');
      expect(result.sourceConnectionId).toBe('conn-source-001');
      expect(result.orderSnapshot).toEqual({ externalOrderId: 'EXT-123', items: [] });
    });

    it('should throw NotFoundException when order not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getOrder('ol_order_999')).rejects.toThrow(NotFoundException);
    });
  });
});
