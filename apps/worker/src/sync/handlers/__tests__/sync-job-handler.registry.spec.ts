/**
 * Sync Job Handler Registry Unit Tests
 *
 * Unit tests for SyncJobHandlerRegistry, verifying handler registration,
 * lookup, and job type validation.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SyncJobHandlerRegistry } from '../sync-job-handler.registry';
import { SyncJobHandler } from '@openlinker/core/sync/domain/ports/sync-job-handler.port';
import { JobType, JobTypeValues } from '@openlinker/core/sync/domain/types/sync-job.types';

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

      registry.register(jobType, mockHandler1);

      const handler = registry.getHandler(jobType);
      expect(handler).toBe(mockHandler1);
    });

    it('should overwrite existing handler with warning', () => {
      const jobType: JobType = 'master.product.syncByExternalId';

      registry.register(jobType, mockHandler1);
      registry.register(jobType, mockHandler2);

      const handler = registry.getHandler(jobType);
      expect(handler).toBe(mockHandler2);
      expect(handler).not.toBe(mockHandler1);
    });

    it('should register multiple handlers for different job types', () => {
      const jobType1: JobType = 'master.product.syncByExternalId';
      const jobType2: JobType = 'master.inventory.syncByExternalId';

      registry.register(jobType1, mockHandler1);
      registry.register(jobType2, mockHandler2);

      expect(registry.getHandler(jobType1)).toBe(mockHandler1);
      expect(registry.getHandler(jobType2)).toBe(mockHandler2);
    });
  });

  describe('getHandler', () => {
    it('should return handler for registered job type', () => {
      const jobType: JobType = 'master.product.syncByExternalId';

      registry.register(jobType, mockHandler1);

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
        registry.register(jobType, mockHandler1);
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

      registry.register(jobType1, mockHandler1);
      registry.register(jobType2, mockHandler2);

      const registeredTypes = registry.getRegisteredJobTypes();
      expect(registeredTypes).toContain(jobType1);
      expect(registeredTypes).toContain(jobType2);
      expect(registeredTypes).toHaveLength(2);
    });

    it('should return all registered job types', () => {
      for (const jobType of JobTypeValues) {
        registry.register(jobType, mockHandler1);
      }

      const registeredTypes = registry.getRegisteredJobTypes();
      expect(registeredTypes).toHaveLength(JobTypeValues.length);
      expect(registeredTypes.sort()).toEqual([...JobTypeValues].sort());
    });

    it('should not include unregistered job types', () => {
      const jobType: JobType = 'master.product.syncByExternalId';

      registry.register(jobType, mockHandler1);

      const registeredTypes = registry.getRegisteredJobTypes();
      expect(registeredTypes).toHaveLength(1);
      expect(registeredTypes).toContain(jobType);
    });
  });
});

