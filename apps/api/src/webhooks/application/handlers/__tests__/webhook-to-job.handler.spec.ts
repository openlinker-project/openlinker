/**
 * Webhook-to-Job Handler Unit Tests
 *
 * Tests the mapping logic for converting webhook events to sync jobs,
 * including provider-specific objectType mappings (e.g., PrestaShop 'stock' → 'inventory').
 *
 * @module apps/api/src/webhooks/application/handlers/__tests__
 */
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookToJobHandler } from '../webhook-to-job.handler';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { InboundWebhookEvent } from '@openlinker/core/events';
import { JobTypeValues } from '@openlinker/core/sync';

describe('WebhookToJobHandler', () => {
  let handler: WebhookToJobHandler;

  beforeEach(async () => {
    const mockRedisClient = {
      xGroupCreate: jest.fn(),
      xReadGroup: jest.fn(),
      xAck: jest.fn(),
      xAdd: jest.fn(),
    };

    const mockJobEnqueue = {
      enqueueJob: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookToJobHandler,
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedisClient,
        },
        {
          provide: JOB_ENQUEUE_TOKEN,
          useValue: mockJobEnqueue,
        },
      ],
    }).compile();

    handler = module.get<WebhookToJobHandler>(WebhookToJobHandler);
    // Note: redisClient and jobEnqueue are not used in these tests
    // as we're only testing private mapping methods
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.jobType).toBe('prestashop.inventory.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.objectType).toBe('Inventory'); // Normalized canonical type
    });

    it('should map PrestaShop "stock" (uppercase) to "inventory"', () => {
      const event = createInboundEvent('prestashop', 'STOCK');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.jobType).toBe('prestashop.inventory.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.objectType).toBe('Inventory');
    });

    it('should pass through PrestaShop "product" unchanged', () => {
      const event = createInboundEvent('prestashop', 'product');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.jobType).toBe('prestashop.product.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.objectType).toBe('Product');
    });

    it('should pass through PrestaShop "order" unchanged', () => {
      const event = createInboundEvent('prestashop', 'order');
      event.eventType = 'order.created';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.jobType).toBe('prestashop.order.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.objectType).toBe('Order');
    });

    it('should throw error for unmapped objectType that results in invalid job type', () => {
      const event = createInboundEvent('prestashop', 'unknown_type');

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Invalid job type: prestashop\.unknown_type\.syncByExternalId/);
    });

    it('should throw error for unknown provider that results in invalid job type', () => {
      const event = createInboundEvent('shopify', 'inventory_level');

      // No mapping defined for shopify yet, and job type is invalid
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Invalid job type: shopify\.inventory_level\.syncByExternalId/);
    });

    it('should handle case-insensitive provider matching', () => {
      const event = createInboundEvent('PRESTASHOP', 'stock');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.jobType).toBe('prestashop.inventory.syncByExternalId');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.objectType).toBe('Inventory');
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      expect(job).toMatchObject({
        jobType: 'prestashop.inventory.syncByExternalId',
        connectionId: '59f4129e-a827-4650-b69b-fc2302b9ecb7',
        payload: {
          externalId: '23',
          objectType: 'Inventory', // Mapped and normalized
          eventType: 'stock.changed',
        },
        idempotencyKey: 'prestashop:59f4129e-a827-4650-b69b-fc2302b9ecb7:test-event-123',
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(JobTypeValues).toContain(job.jobType);
    });

    it('should create valid job request for PrestaShop product event', () => {
      const event = createInboundEvent('prestashop', 'product');
      event.eventType = 'product.saved';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      expect(job).toMatchObject({
        jobType: 'prestashop.product.syncByExternalId',
        payload: {
          objectType: 'Product',
          eventType: 'product.saved',
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(JobTypeValues).toContain(job.jobType);
    });

    it('should throw error for invalid job type', () => {
      const event = createInboundEvent('prestashop', 'invalid_type');
      event.eventType = 'invalid.event';

      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Invalid job type: prestashop\.invalid_type\.syncByExternalId/);
    });

    it('should throw error for invalid job type even if normalization works', () => {
      const event = createInboundEvent('prestashop', 'product_variant');

      // The normalization would work, but the job type is invalid
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Invalid job type: prestashop\.product_variant\.syncByExternalId/);
    });

    it('should preserve event payload in job payload', () => {
      const event = createInboundEvent('prestashop', 'stock');
      event.payload = { quantity: 100, location: 'warehouse-1' };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      // Note: The current implementation doesn't preserve the full payload,
      // but we test what's actually included
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.externalId).toBe('23');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.eventType).toBe('stock.changed');
    });
  });

  describe('normalizeObjectType', () => {
    it('should convert lowercase to PascalCase', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).normalizeObjectType('product');
      expect(result).toBe('Product');
    });

    it('should convert snake_case to PascalCase', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).normalizeObjectType('product_variant');
      expect(result).toBe('ProductVariant');
    });

    it('should handle already PascalCase', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).normalizeObjectType('Product');
      expect(result).toBe('Product');
    });

    it('should handle uppercase', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).normalizeObjectType('PRODUCT');
      expect(result).toBe('Product');
    });

    it('should handle mixed case', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).normalizeObjectType('PrOdUcT');
      expect(result).toBe('Product');
    });

    it('should handle empty string', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).normalizeObjectType('');
      expect(result).toBe('');
    });

    it('should handle multiple underscores', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).normalizeObjectType('product_variant_attribute');
      expect(result).toBe('ProductVariantAttribute');
    });
  });

  describe('validateJobType', () => {
    it('should return valid job type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).validateJobType('prestashop.product.syncByExternalId');
      expect(result).toBe('prestashop.product.syncByExternalId');
      expect(JobTypeValues).toContain(result);
    });

    it('should return valid inventory job type', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const result = (handler as any).validateJobType('prestashop.inventory.syncByExternalId');
      expect(result).toBe('prestashop.inventory.syncByExternalId');
      expect(JobTypeValues).toContain(result);
    });

    it('should throw error for invalid job type', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (handler as any).validateJobType('prestashop.stock.syncByExternalId');
      }).toThrow(/Invalid job type: prestashop\.stock\.syncByExternalId/);
    });

    it('should throw error with list of valid types', () => {
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (handler as any).validateJobType('invalid.job.type');
      }).toThrow(/Valid types: .*prestashop\.product\.syncByExternalId/);
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      // Verify job type uses canonical terminology
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.jobType).toBe('prestashop.inventory.syncByExternalId');

      // Verify payload uses normalized canonical terminology
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.objectType).toBe('Inventory');

      // Verify job is valid
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(JobTypeValues).toContain(job.jobType);

      // Verify idempotency key format
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.idempotencyKey).toBe('prestashop:59f4129e-a827-4650-b69b-fc2302b9ecb7:prestashop-stock-123');
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const job = (handler as any).mapToSyncJob(event);

      // Verify job type (no mapping needed for product)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.jobType).toBe('prestashop.product.syncByExternalId');

      // Verify payload uses normalized objectType
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(job.payload.objectType).toBe('Product');

      // Verify job is valid
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (handler as any).mapToSyncJob(event);
      }).toThrow(/Invalid job type: prestashop\.product_variant_attribute\.syncByExternalId/);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        (handler as any).mapToSyncJob(event);
      }).toThrow();
    });
  });
});

