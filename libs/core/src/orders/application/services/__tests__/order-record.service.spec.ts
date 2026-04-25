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
import { Order } from '../../../domain/types/order.types';
import type { IncomingOrder } from '../../../domain/types/incoming-order.types';
import { ORDER_RECORD_REPOSITORY_TOKEN } from '../../../orders.tokens';

describe('OrderRecordService', () => {
  let service: OrderRecordService;
  let repository: jest.Mocked<OrderRecordRepositoryPort>;

  const originalEnv = process.env.OL_STORE_PII;
  const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;

  beforeEach(async () => {
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

  const createMockIncomingOrder = (): IncomingOrder => ({
    externalOrderId: 'ext-order-789',
    orderNumber: 'ORD-001',
    status: 'pending',
    customerExternalId: 'ext-customer-456',
    customerEmail: 'buyer@example.com',
    items: [
      {
        id: 'item-1',
        productRef: { type: 'offer', externalId: 'offer-abc' },
        quantity: 2,
        price: 10.99,
        sku: 'SKU-001',
      },
    ],
    totals: { subtotal: 21.98, tax: 4.40, shipping: 5.00, total: 31.38, currency: 'USD' },
    shippingAddress: {
      firstName: 'John',
      lastName: 'Doe',
      address1: '123 Main St',
      city: 'New York',
      postalCode: '10001',
      country: 'US',
    },
    createdAt: '2025-01-01T10:00:00Z',
    updatedAt: '2025-01-01T10:00:00Z',
  });

  describe('persistOrder - PII enabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
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
        'ready',
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
      expect(callArg.recordStatus).toBe('ready');
    });

    it('should serialise OrderItem.name and imageUrl into the snapshot when present', async () => {
      const order = createMockOrder();
      order.items[0].name = 'Widget';
      order.items[0].imageUrl = 'https://cdn.example/widget.jpg';

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const callArg = repository.upsert.mock.calls[0][0];
      const snapshotItems = (callArg.orderSnapshot as { items: Array<Record<string, unknown>> }).items;
      expect(snapshotItems[0]).toMatchObject({
        id: 'item-1',
        name: 'Widget',
        imageUrl: 'https://cdn.example/widget.jpg',
      });
    });

    it('should omit name and imageUrl from the snapshot when the OrderItem does not carry them', async () => {
      const order = createMockOrder();
      // createMockOrder() leaves name/imageUrl unset; this asserts conditional
      // serialisation in persistOrder keeps the keys absent rather than emitting
      // explicit `undefined` (the snapshot is a stable JSON contract).
      expect(order.items[0].name).toBeUndefined();
      expect(order.items[0].imageUrl).toBeUndefined();

      repository.upsert.mockResolvedValue({} as OrderRecord);

      await service.persistOrder(order, 'source-connection-123', 'event-456');

      const callArg = repository.upsert.mock.calls[0][0];
      const snapshotItems = (callArg.orderSnapshot as { items: Array<Record<string, unknown>> }).items;
      expect(snapshotItems[0]).not.toHaveProperty('name');
      expect(snapshotItems[0]).not.toHaveProperty('imageUrl');
    });
  });

  describe('persistOrder - PII disabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'false';
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
        'ready',
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
        country: 'US',
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
        'ready',
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

  describe('persistIncomingSnapshot', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      service = new OrderRecordService(repository);
    });

    it('should persist incoming snapshot with awaiting_mapping status', async () => {
      const incoming = createMockIncomingOrder();
      const internalOrderId = 'ol_order_abc123';
      const customerId = 'ol_customer_xyz';
      const sourceConnectionId = 'conn-123';
      const sourceEventId = 'event-456';

      const expectedRecord = new OrderRecord(
        internalOrderId,
        customerId,
        sourceConnectionId,
        sourceEventId,
        expect.objectContaining({ externalOrderId: incoming.externalOrderId }),
        [],
        'awaiting_mapping',
        expect.any(Date),
        expect.any(Date),
      );

      repository.upsert.mockResolvedValue(expectedRecord);

      const result = await service.persistIncomingSnapshot(
        incoming,
        internalOrderId,
        customerId,
        sourceConnectionId,
        sourceEventId,
      );

      expect(result).toBe(expectedRecord);
      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.recordStatus).toBe('awaiting_mapping');
      expect(callArg.orderSnapshot['externalOrderId']).toBe(incoming.externalOrderId);
      expect(callArg.orderSnapshot['items']).toEqual(incoming.items);
    });

    it('should sanitize addresses in snapshot when PII is disabled', async () => {
      process.env.OL_STORE_PII = 'false';
      service = new OrderRecordService(repository);

      const incoming = createMockIncomingOrder();
      const expectedRecord = new OrderRecord(
        'ol_order_abc',
        null,
        'conn-123',
        null,
        expect.objectContaining({}),
        [],
        'awaiting_mapping',
        expect.any(Date),
        expect.any(Date),
      );
      repository.upsert.mockResolvedValue(expectedRecord);

      await service.persistIncomingSnapshot(incoming, 'ol_order_abc', null, 'conn-123', null);

      const callArg = repository.upsert.mock.calls[0][0];
      expect(callArg.orderSnapshot['shippingAddress']).toEqual({
        address1: '[REDACTED]',
        city: '[REDACTED]',
        postalCode: '[REDACTED]',
        country: 'US',
      });
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
        'ready',
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
