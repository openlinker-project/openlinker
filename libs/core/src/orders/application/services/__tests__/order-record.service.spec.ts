/**
 * Order Record Service Unit Tests
 *
 * Unit tests for OrderRecordService, verifying PII-aware snapshot handling,
 * order persistence, and sync status updates.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { Test, TestingModule } from '@nestjs/testing';
import { OrderRecordService } from '../order-record.service';
import { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import { OrderRecord, OrderSyncStatus } from '../../../domain/entities/order-record.entity';
import { Order } from '../../../domain/ports/order-source.port';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../../orders.tokens';

describe('OrderRecordService', () => {
  let service: OrderRecordService;
  let repository: jest.Mocked<OrderRecordRepositoryPort>;

  const originalEnv = process.env.OL_STORE_PII;
  const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;

  beforeEach(async () => {
    // Set required environment variable for PII config
    process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';
    repository = {
      findById: jest.fn(),
      upsert: jest.fn(),
      updateSyncStatus: jest.fn(),
    } as unknown as jest.Mocked<OrderRecordRepositoryPort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderRecordService,
        {
          provide: ORDER_RECORD_REPOSITORY_TOKEN,
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<OrderRecordService>(OrderRecordService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalEnv) {
      process.env.OL_STORE_PII = originalEnv;
    } else {
      delete process.env.OL_STORE_PII;
    }
    if (originalPiiHashSalt) {
      process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
    } else {
      delete process.env.OL_PII_HASH_SALT;
    }
  });

  const createMockOrder = (): Order => ({
    id: 'order-123',
    orderNumber: 'ORD-001',
    status: 'pending',
    customerId: 'customer-456',
    items: [
      {
        id: 'item-1',
        productId: 'product-1',
        variantId: 'variant-1',
        quantity: 2,
        price: 10.99,
        sku: 'SKU-001',
      },
    ],
    totals: {
      subtotal: 21.98,
      tax: 4.40,
      shipping: 5.00,
      total: 31.38,
      currency: 'USD',
    },
    shippingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      company: 'Acme Corp',
      address1: '123 Main St',
      address2: 'Apt 4B',
      city: 'New York',
      state: 'NY',
      postalCode: '10001',
      country: 'US',
      phone: '+1234567890',
    },
    billingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      address1: '123 Main St',
      city: 'New York',
      postalCode: '10001',
      country: 'US',
    },
    createdAt: new Date('2025-01-01T10:00:00Z'),
    updatedAt: new Date('2025-01-01T10:00:00Z'),
  });

  describe('persistOrder - PII enabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      // Recreate service to pick up new env var
      service = new OrderRecordService(repository);
    });

    it('should persist order with all PII fields when PII storage is enabled', async () => {
      const order = createMockOrder();
      const sourceConnectionId = 'source-connection-123';
      const sourceEventId = 'event-456';

      const expectedOrderRecord = new OrderRecord(
        order.id,
        order.customerId || null,
        sourceConnectionId,
        sourceEventId,
        expect.objectContaining({
          id: order.id,
          orderNumber: order.orderNumber,
          shippingAddress: order.shippingAddress,
          billingAddress: order.billingAddress,
        }),
        [],
        expect.any(Date),
        expect.any(Date),
      );

      repository.upsert.mockResolvedValue(expectedOrderRecord);

      const result = await service.persistOrder(order, sourceConnectionId, sourceEventId);

      expect(result).toBe(expectedOrderRecord);
      expect(repository.upsert).toHaveBeenCalledTimes(1);
      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot.shippingAddress).toEqual(order.shippingAddress);
      expect(callArg.orderSnapshot.billingAddress).toEqual(order.billingAddress);
    });
  });

  describe('persistOrder - PII disabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'false';
      // Recreate service to pick up new env var
      service = new OrderRecordService(repository);
    });

    it('should persist order with sanitized addresses when PII storage is disabled', async () => {
      const order = createMockOrder();
      const sourceConnectionId = 'source-connection-123';
      const sourceEventId = 'event-456';

      const expectedOrderRecord = new OrderRecord(
        order.id,
        order.customerId || null,
        sourceConnectionId,
        sourceEventId,
        expect.objectContaining({
          id: order.id,
          orderNumber: order.orderNumber,
        }),
        [],
        expect.any(Date),
        expect.any(Date),
      );

      repository.upsert.mockResolvedValue(expectedOrderRecord);

      const result = await service.persistOrder(order, sourceConnectionId, sourceEventId);

      expect(result).toBe(expectedOrderRecord);
      expect(repository.upsert).toHaveBeenCalledTimes(1);
      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot.shippingAddress).toEqual({
        address1: '[REDACTED]',
        city: '[REDACTED]',
        postalCode: '[REDACTED]',
        country: 'US', // Country code is not PII
      });
      expect(callArg.orderSnapshot.billingAddress).toEqual({
        address1: '[REDACTED]',
        city: '[REDACTED]',
        postalCode: '[REDACTED]',
        country: 'US',
      });
    });

    it('should handle missing addresses gracefully', async () => {
      const order = createMockOrder();
      order.shippingAddress = undefined;
      order.billingAddress = undefined;

      const sourceConnectionId = 'source-connection-123';
      const sourceEventId = 'event-456';

      const expectedOrderRecord = new OrderRecord(
        order.id,
        order.customerId || null,
        sourceConnectionId,
        sourceEventId,
        expect.objectContaining({
          id: order.id,
        }),
        [],
        expect.any(Date),
        expect.any(Date),
      );

      repository.upsert.mockResolvedValue(expectedOrderRecord);

      const result = await service.persistOrder(order, sourceConnectionId, sourceEventId);

      expect(result).toBe(expectedOrderRecord);
      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot.shippingAddress).toBeUndefined();
      expect(callArg.orderSnapshot.billingAddress).toBeUndefined();
    });
  });

  describe('updateSyncStatus', () => {
    it('should update sync status for a destination', async () => {
      const internalOrderId = 'order-123';
      const destinationConnectionId = 'dest-connection-456';
      const status: OrderSyncStatus = {
        destinationConnectionId,
        status: 'synced',
        syncedAt: new Date(),
        externalOrderId: 'external-order-789',
        externalOrderNumber: 'EXT-001',
      };

      repository.updateSyncStatus.mockResolvedValue();

      await service.updateSyncStatus(internalOrderId, destinationConnectionId, status);

      expect(repository.updateSyncStatus).toHaveBeenCalledWith(
        internalOrderId,
        destinationConnectionId,
        status,
      );
    });

    it('should handle failed sync status', async () => {
      const internalOrderId = 'order-123';
      const destinationConnectionId = 'dest-connection-456';
      const status: OrderSyncStatus = {
        destinationConnectionId,
        status: 'failed',
        error: 'Sync failed: Connection timeout',
      };

      repository.updateSyncStatus.mockResolvedValue();

      await service.updateSyncStatus(internalOrderId, destinationConnectionId, status);

      expect(repository.updateSyncStatus).toHaveBeenCalledWith(
        internalOrderId,
        destinationConnectionId,
        status,
      );
    });
  });

  describe('getOrderRecord', () => {
    it('should retrieve order record by ID', async () => {
      const internalOrderId = 'order-123';
      const expectedRecord = new OrderRecord(
        internalOrderId,
        'customer-456',
        'source-connection-123',
        'event-456',
        { id: internalOrderId },
        [],
        new Date(),
        new Date(),
      );

      repository.findById.mockResolvedValue(expectedRecord);

      const result = await service.getOrderRecord(internalOrderId);

      expect(result).toBe(expectedRecord);
      expect(repository.findById).toHaveBeenCalledWith(internalOrderId);
    });

    it('should return null when order record not found', async () => {
      const internalOrderId = 'non-existent-order';

      repository.findById.mockResolvedValue(null);

      const result = await service.getOrderRecord(internalOrderId);

      expect(result).toBeNull();
      expect(repository.findById).toHaveBeenCalledWith(internalOrderId);
    });
  });
});
