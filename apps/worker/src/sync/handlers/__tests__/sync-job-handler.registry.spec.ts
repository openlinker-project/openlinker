/**
 * Sync Job Handler Registry Unit Tests
 *
 * Unit tests for SyncJobHandlerRegistry, verifying handler registration,
 * lookup, and job type validation.
 *
 * @module apps/worker/src/sync/handlers
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { SyncJobHandlerRegistry } from '../sync-job-handler.registry';
import type { SyncJobHandler } from '@openlinker/core/sync';
import type { JobType } from '@openlinker/core/sync';
import { JobTypeValues } from '@openlinker/core/sync';

describe('SyncJobHandlerRegistry', () => {
  let registry: SyncJobHandlerRegistry;
  let mockHandler1: jest.Mocked<SyncJobHandler>;
  let mockHandler2: jest.Mocked<SyncJobHandler>;
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [SyncJobHandlerRegistry],
    }).compile();

    registry = moduleRef.get<SyncJobHandlerRegistry>(SyncJobHandlerRegistry);

    // Create mock handlers
    mockHandler1 = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<SyncJobHandler>;

    mockHandler2 = {
      execute: jest.fn(),
    } as unknown as jest.Mocked<SyncJobHandler>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    // Close the testing module to trigger OnModuleDestroy on all providers
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  describe('register', () => {
    it('should register handler for job type', () => {
      const jobType: JobType = 'master.product.syncByExternalId';

      registry.register(jobType, mockHandler1, 'realtime');

      const handler = registry.getHandler(jobType);
      expect(handler).toBe(mockHandler1);
    });

    it('should overwrite existing handler with warning', () => {
      const jobType: JobType = 'master.product.syncByExternalId';

      registry.register(jobType, mockHandler1, 'realtime');
      registry.register(jobType, mockHandler2, 'realtime');

      const handler = registry.getHandler(jobType);
      expect(handler).toBe(mockHandler2);
      expect(handler).not.toBe(mockHandler1);
    });

    it('should register multiple handlers for different job types', () => {
      const jobType1: JobType = 'master.product.syncByExternalId';
      const jobType2: JobType = 'master.inventory.syncByExternalId';

      registry.register(jobType1, mockHandler1, 'realtime');
      registry.register(jobType2, mockHandler2, 'realtime');

      expect(registry.getHandler(jobType1)).toBe(mockHandler1);
      expect(registry.getHandler(jobType2)).toBe(mockHandler2);
    });
  });

  describe('getHandler', () => {
    it('should return handler for registered job type', () => {
      const jobType: JobType = 'master.product.syncByExternalId';

      registry.register(jobType, mockHandler1, 'realtime');

      const handler = registry.getHandler(jobType);
      expect(handler).toBe(mockHandler1);
    });

    it('should return null for unregistered job type', () => {
      const jobType: JobType = 'master.product.syncByExternalId';

      const handler = registry.getHandler(jobType);
      expect(handler).toBeNull();
    });

    it('should return null for invalid job type', () => {
      const invalidJobType = 'invalid.job.type';

      const handler = registry.getHandler(invalidJobType);
      expect(handler).toBeNull();
    });

    it('should return null for empty string', () => {
      const handler = registry.getHandler('');
      expect(handler).toBeNull();
    });

    it('should handle all valid job types', () => {
      for (const jobType of JobTypeValues) {
        registry.register(jobType, mockHandler1, 'realtime');
        const handler = registry.getHandler(jobType);
        expect(handler).toBe(mockHandler1);
      }
    });
  });

  describe('getRegisteredJobTypes', () => {
    it('should return empty array when no handlers registered', () => {
      const registeredTypes = registry.getRegisteredJobTypes();
      expect(registeredTypes).toEqual([]);
    });

    it('should return array of registered job types', () => {
      const jobType1: JobType = 'master.product.syncByExternalId';
      const jobType2: JobType = 'master.inventory.syncByExternalId';

      registry.register(jobType1, mockHandler1, 'realtime');
      registry.register(jobType2, mockHandler2, 'realtime');

      const registeredTypes = registry.getRegisteredJobTypes();
      expect(registeredTypes).toContain(jobType1);
      expect(registeredTypes).toContain(jobType2);
      expect(registeredTypes).toHaveLength(2);
    });

    it('should return all registered job types', () => {
      for (const jobType of JobTypeValues) {
        registry.register(jobType, mockHandler1, 'realtime');
      }

      const registeredTypes = registry.getRegisteredJobTypes();
      expect(registeredTypes).toHaveLength(JobTypeValues.length);
      expect(registeredTypes.sort()).toEqual([...JobTypeValues].sort());
    });

    it('should not include unregistered job types', () => {
      const jobType: JobType = 'master.product.syncByExternalId';

      registry.register(jobType, mockHandler1, 'realtime');

      const registeredTypes = registry.getRegisteredJobTypes();
      expect(registeredTypes).toHaveLength(1);
      expect(registeredTypes).toContain(jobType);
    });
  });

  describe('lane metadata (ADR-050, #2278)', () => {
    it('should return the lane a job type was registered under', () => {
      registry.register('marketplace.order.sync', mockHandler1, 'realtime');
      registry.register('marketplace.offer.create', mockHandler2, 'bulk');

      expect(registry.getLane('marketplace.order.sync')).toBe('realtime');
      expect(registry.getLane('marketplace.offer.create')).toBe('bulk');
    });

    it('should return null lane for an unregistered job type', () => {
      expect(registry.getLane('marketplace.order.sync')).toBeNull();
    });

    it('should return the job types belonging to a lane', () => {
      registry.register('marketplace.order.sync', mockHandler1, 'realtime');
      registry.register('marketplace.offerQuantity.update', mockHandler1, 'realtime');
      registry.register('marketplace.offer.create', mockHandler2, 'bulk');

      expect(registry.getJobTypesByLane('realtime').sort()).toEqual([
        'marketplace.offerQuantity.update',
        'marketplace.order.sync',
      ]);
      expect(registry.getJobTypesByLane('bulk')).toEqual(['marketplace.offer.create']);
      expect(registry.getJobTypesByLane('fiscal')).toEqual([]);
    });
  });

  describe('assertFullLaneCoverage (ADR-050 D1 / ADR-051 D6)', () => {
    it('should pass when every JobTypeValues member is registered with a lane', () => {
      for (const jobType of JobTypeValues) {
        registry.register(jobType, mockHandler1, 'realtime');
      }

      expect(() => registry.assertFullLaneCoverage()).not.toThrow();
    });

    it('should throw naming the uncovered job types when the partition is incomplete', () => {
      for (const jobType of JobTypeValues) {
        if (jobType === 'marketplace.order.sync') continue;
        registry.register(jobType, mockHandler1, 'realtime');
      }

      expect(() => registry.assertFullLaneCoverage()).toThrow('marketplace.order.sync');
    });
  });
});
