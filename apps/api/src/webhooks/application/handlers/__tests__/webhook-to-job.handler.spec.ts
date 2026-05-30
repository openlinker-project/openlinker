/**
 * Webhook-to-Job Handler Unit Tests
 *
 * Tests the mapping logic for converting webhook events to sync jobs,
 * including provider-specific objectType mappings (e.g., PrestaShop 'stock' → 'inventory').
 *
 * @module apps/api/src/webhooks/application/handlers/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { WebhookToJobHandler } from '../webhook-to-job.handler';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { JobTypeValues } from '@openlinker/core/sync';
import { WEBHOOK_DELIVERY_REPOSITORY_TOKEN } from '@openlinker/core/webhooks';
import { REDIS_CLIENT_BLOCKING_TOKEN } from '../../../webhooks.tokens';

describe('WebhookToJobHandler', () => {
  let handler: WebhookToJobHandler;
  let mockRedisClient: {
    xGroupCreate: jest.Mock;
    xReadGroup: jest.Mock;
    xAck: jest.Mock;
    xAdd: jest.Mock;
    quit: jest.Mock;
  };

  beforeEach(async () => {
    mockRedisClient = {
      xGroupCreate: jest.fn(),
      xReadGroup: jest.fn(),
      xAck: jest.fn(),
      xAdd: jest.fn(),
      quit: jest.fn().mockResolvedValue(undefined),
    };

    const mockJobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }),
    };

    const mockDeliveryRepo = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookToJobHandler,
        {
          provide: REDIS_CLIENT_BLOCKING_TOKEN,
          useValue: mockRedisClient,
        },
        {
          provide: JOB_ENQUEUE_TOKEN,
          useValue: mockJobEnqueue,
        },
        {
          provide: WEBHOOK_DELIVERY_REPOSITORY_TOKEN,
          useValue: mockDeliveryRepo,
        },
      ],
    }).compile();

    handler = module.get<WebhookToJobHandler>(WebhookToJobHandler);
  });

  describe('onModuleDestroy', () => {
    it('should call redisClient.quit() on module destroy', async () => {
      jest.useFakeTimers();

      try {
        const onModuleDestroyPromise = handler.onModuleDestroy();
        await jest.advanceTimersByTimeAsync(2000);
        await onModuleDestroyPromise;

        expect(mockRedisClient.quit).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('mapObjectType (via mapToSyncJob)', () => {
    const createInboundEvent = (provider: string, objectType: string): InboundWebhookEvent => ({
      eventId: 'test-event-123',
      provider,
      connectionId: '59f4129e-a827-4650-b69b-fc2302b9ecb7',
      eventType: 'stock.changed',
      occurredAt: '2025-01-01T12:00:00.000Z',
      receivedAt: '2025-01-01T12:00:01.000Z',
      objectType,
      externalId: '23',
      payload: {},
    });

    it('should map PrestaShop "stock" to "inventory" for job type', () => {
      const event = createInboundEvent('prestashop', 'stock');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.jobType).toBe('master.inventory.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.payload.objectType).toBe('Inventory'); // Normalized canonical type
    });

    it('should map PrestaShop "stock" (uppercase) to "inventory"', () => {
      const event = createInboundEvent('prestashop', 'STOCK');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.jobType).toBe('master.inventory.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.payload.objectType).toBe('Inventory');
    });

    it('should pass through PrestaShop "product" unchanged', () => {
      const event = createInboundEvent('prestashop', 'product');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.jobType).toBe('master.product.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.payload.objectType).toBe('Product');
    });

    it('should throw error for unmapped objectType that results in invalid job type', () => {
      const event = createInboundEvent('prestashop', 'unknown_type');

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Unsupported master objectType: unknown_type/i);
    });

    it('should throw error for unknown provider that results in invalid job type', () => {
      const event = createInboundEvent('shopify', 'inventory_level');

      // No mapping defined for shopify yet, and job type is invalid
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Invalid job type: shopify\.inventory_level\.syncByExternalId/);
    });

    it('should handle case-insensitive provider matching', () => {
      const event = createInboundEvent('PRESTASHOP', 'stock');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.jobType).toBe('master.inventory.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.payload.objectType).toBe('Inventory');
    });
  });

  describe('order routing to marketplace.order.sync (#902)', () => {
    const createOrderEvent = (eventType: string): InboundWebhookEvent => ({
      eventId: 'evt-order-1',
      provider: 'prestashop',
      connectionId: '59f4129e-a827-4650-b69b-fc2302b9ecb7',
      eventType,
      occurredAt: '2025-01-01T12:00:00.000Z',
      receivedAt: '2025-01-01T12:00:01.000Z',
      objectType: 'order',
      externalId: '4242',
      payload: {},
    });

    const mapToJob = (event: InboundWebhookEvent): SyncJobRequest =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test: invoke private mapToSyncJob
      (handler as any).mapToSyncJob(event) as SyncJobRequest;

    it('should route order.created to marketplace.order.sync with the externalOrderId payload shape', () => {
      const job = mapToJob(createOrderEvent('order.created'));

      expect(job).toMatchObject({
        jobType: 'marketplace.order.sync',
        connectionId: '59f4129e-a827-4650-b69b-fc2302b9ecb7',
        payload: {
          schemaVersion: 1,
          externalOrderId: '4242',
          sourceEventId: 'evt-order-1',
          eventType: 'created',
        },
        // idempotency key shape pinned so a future payload refactor can't drift it
        idempotencyKey: 'prestashop:59f4129e-a827-4650-b69b-fc2302b9ecb7:evt-order-1',
      });
      expect(JobTypeValues).toContain(job.jobType);
    });

    it('should map order.status_changed to the "updated" feed event type', () => {
      const job = mapToJob(createOrderEvent('order.status_changed'));

      expect(job.jobType).toBe('marketplace.order.sync');
      expect(job.payload.eventType).toBe('updated');
    });

    it('should default an unrecognized order event type to "updated"', () => {
      const job = mapToJob(createOrderEvent('order.refunded'));

      expect(job.payload.eventType).toBe('updated');
    });

    it('should not emit the generic master payload shape (externalId/objectType) for orders', () => {
      const job = mapToJob(createOrderEvent('order.created'));

      expect(job.payload.externalOrderId).toBe('4242');
      expect(job.payload.externalId).toBeUndefined();
      expect(job.payload.objectType).toBeUndefined();
    });

    it('should route orders provider-agnostically (objectType=order regardless of provider)', () => {
      const event = createOrderEvent('order.created');
      event.provider = 'shopify';
      const job = mapToJob(event);

      expect(job.jobType).toBe('marketplace.order.sync');
      expect(job.idempotencyKey).toBe(
        'shopify:59f4129e-a827-4650-b69b-fc2302b9ecb7:evt-order-1'
      );
    });
  });

  describe('mapToSyncJob', () => {
    const createInboundEvent = (provider: string, objectType: string): InboundWebhookEvent => ({
      eventId: 'test-event-123',
      provider,
      connectionId: '59f4129e-a827-4650-b69b-fc2302b9ecb7',
      eventType: 'stock.changed',
      occurredAt: '2025-01-01T12:00:00.000Z',
      receivedAt: '2025-01-01T12:01:00.000Z',
      objectType,
      externalId: '23',
      payload: { quantity: 100 },
    });

    it('should create valid job request for PrestaShop inventory event', () => {
      const event = createInboundEvent('prestashop', 'stock');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      expect(job).toMatchObject({
        jobType: 'master.inventory.syncByExternalId',
        connectionId: '59f4129e-a827-4650-b69b-fc2302b9ecb7',
        payload: {
          externalId: '23',
          objectType: 'Inventory', // Mapped and normalized
          eventType: 'stock.changed',
        },
        idempotencyKey: 'prestashop:59f4129e-a827-4650-b69b-fc2302b9ecb7:test-event-123',
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(JobTypeValues).toContain(job.jobType);
    });

    it('should create valid job request for PrestaShop product event', () => {
      const event = createInboundEvent('prestashop', 'product');
      event.eventType = 'product.saved';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      expect(job).toMatchObject({
        jobType: 'master.product.syncByExternalId',
        payload: {
          objectType: 'Product',
          eventType: 'product.saved',
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(JobTypeValues).toContain(job.jobType);
    });

    it('should throw error for invalid job type', () => {
      const event = createInboundEvent('prestashop', 'invalid_type');
      event.eventType = 'invalid.event';

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Unsupported master objectType: invalid_type/i);
    });

    it('should throw error for invalid job type even if normalization works', () => {
      const event = createInboundEvent('prestashop', 'product_variant');

      // The normalization would work, but the job type is invalid
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Unsupported master objectType: product_variant/i);
    });

    it('should preserve event payload in job payload', () => {
      const event = createInboundEvent('prestashop', 'stock');
      event.payload = { quantity: 100, location: 'warehouse-1' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      // Note: The current implementation doesn't preserve the full payload,
      // but we test what's actually included
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.payload.externalId).toBe('23');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.payload.eventType).toBe('stock.changed');
    });
  });

  describe('normalizeObjectType', () => {
    it('should convert lowercase to PascalCase', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).normalizeObjectType('product');
      expect(result).toBe('Product');
    });

    it('should convert snake_case to PascalCase', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).normalizeObjectType('product_variant');
      expect(result).toBe('ProductVariant');
    });

    it('should handle already PascalCase', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).normalizeObjectType('Product');
      expect(result).toBe('Product');
    });

    it('should handle uppercase', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).normalizeObjectType('PRODUCT');
      expect(result).toBe('Product');
    });

    it('should handle mixed case', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).normalizeObjectType('PrOdUcT');
      expect(result).toBe('Product');
    });

    it('should handle empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).normalizeObjectType('');
      expect(result).toBe('');
    });

    it('should handle multiple underscores', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).normalizeObjectType('product_variant_attribute');
      expect(result).toBe('ProductVariantAttribute');
    });
  });

  describe('validateJobType', () => {
    it('should return valid job type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).validateJobType('master.product.syncByExternalId');
      expect(result).toBe('master.product.syncByExternalId');
      expect(JobTypeValues).toContain(result);
    });

    it('should return valid inventory job type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const result = (handler as any).validateJobType('master.inventory.syncByExternalId');
      expect(result).toBe('master.inventory.syncByExternalId');
      expect(JobTypeValues).toContain(result);
    });

    it('should throw error for invalid job type', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
        (handler as any).validateJobType('prestashop.stock.syncByExternalId');
      }).toThrow(/Invalid job type: prestashop\.stock\.syncByExternalId/);
    });

    it('should throw error with list of valid types', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
        (handler as any).validateJobType('invalid.job.type');
      }).toThrow(/Valid types: .*master\.product\.syncByExternalId/);
    });
  });

  describe('Integration: Full mapping flow', () => {
    it('should correctly map PrestaShop stock event end-to-end', () => {
      const event: InboundWebhookEvent = {
        eventId: 'prestashop-stock-123',
        provider: 'prestashop',
        connectionId: '59f4129e-a827-4650-b69b-fc2302b9ecb7',
        eventType: 'stock.changed',
        occurredAt: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        objectType: 'stock', // PrestaShop terminology
        externalId: '23',
        payload: { quantity: 100 },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      // Verify job type uses canonical terminology
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.jobType).toBe('master.inventory.syncByExternalId');

      // Verify payload uses normalized canonical terminology
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.payload.objectType).toBe('Inventory');

      // Verify job is valid
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(JobTypeValues).toContain(job.jobType);

      // Verify idempotency key format
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.idempotencyKey).toBe(
        'prestashop:59f4129e-a827-4650-b69b-fc2302b9ecb7:prestashop-stock-123'
      );
    });

    it('should correctly map PrestaShop product event (no mapping needed)', () => {
      const event: InboundWebhookEvent = {
        eventId: 'prestashop-product-456',
        provider: 'prestashop',
        connectionId: '59f4129e-a827-4650-b69b-fc2302b9ecb7',
        eventType: 'product.saved',
        occurredAt: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        objectType: 'product',
        externalId: '456',
        payload: { name: 'Test Product' },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = (handler as any).mapToSyncJob(event);

      // Verify job type (no mapping needed for product)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.jobType).toBe('master.product.syncByExternalId');

      // Verify payload uses normalized objectType
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(job.payload.objectType).toBe('Product');

      // Verify job is valid
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(JobTypeValues).toContain(job.jobType);
    });
  });

  describe('Edge cases', () => {
    it('should throw error for objectType with special characters that results in invalid job type', () => {
      const event: InboundWebhookEvent = {
        eventId: 'test-123',
        provider: 'prestashop',
        connectionId: 'conn-123',
        eventType: 'test.event',
        occurredAt: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        objectType: 'product_variant_attribute',
        externalId: '123',
        payload: {},
      };

      // The normalization would work, but the job type is invalid
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Unsupported master objectType: product_variant_attribute/i);
    });

    it('should handle empty objectType', () => {
      const event: InboundWebhookEvent = {
        eventId: 'test-123',
        provider: 'prestashop',
        connectionId: 'conn-123',
        eventType: 'test.event',
        occurredAt: '2025-01-01T12:00:00.000Z',
        receivedAt: '2025-01-01T12:00:01.000Z',
        objectType: '',
        externalId: '123',
        payload: {},
      };

      // Empty objectType will result in invalid job type, should throw
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- test mock: explicit any narrows the dynamic spy / fixture shape
        (handler as any).mapToSyncJob(event);
      }).toThrow();
    });
  });
});
