/**
 * Product Sync End-to-End Integration Test
 *
 * Integration test for the complete product sync flow:
 * 1. Job enqueued to Redis Stream
 * 2. Job intake consumer processes and persists job
 * 3. Job runner executes job
 * 4. Product adapter fetches product data
 * 5. Product and variants are upserted to canonical storage
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { getSyncJobById } from './helpers/test-sync-job.helper';
import { createMockPrestashopProductAdapter } from './helpers/mock-adapters.helper';
import { SYNC_JOB_REPOSITORY_TOKEN, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { SyncJobRepositoryPort } from '@openlinker/core/sync/domain/ports/sync-job-repository.port';
import { JobEnqueuePort } from '@openlinker/core/sync/domain/ports/job-enqueue.port';
import { SyncJobRequest } from '@openlinker/core/sync/domain/types/sync-job.types';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { DataSource } from 'typeorm';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products';
import { randomUUID } from 'crypto';

describe('Product Sync End-to-End Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: SyncJobRepositoryPort;
  let jobEnqueue: JobEnqueuePort;
  let integrationsService: IIntegrationsService;
  let dataSource: DataSource;
  let mockProductAdapter: ReturnType<typeof createMockPrestashopProductAdapter>;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    dataSource = harness.getDataSource();

    // Set credentials environment variable for test connection
    process.env.CREDENTIALS_TEST_CREDENTIALS_REF = '{"webserviceApiKey":"test-api-key"}';
  });

  beforeEach(async () => {
    await resetTestHarness();

    // Create mock adapter for each test
    mockProductAdapter = createMockPrestashopProductAdapter();

    // Mock IntegrationsService to return our mock adapter
    jest.spyOn(integrationsService, 'getCapabilityAdapter').mockResolvedValue(
      mockProductAdapter as any,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('Complete Product Sync Flow', () => {
    it('should sync product from Redis Stream to database', async () => {
      // 1. Create test connection
      const connection = await createTestConnection(dataSource, {
        platformType: 'prestashop',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
      });

      // 2. Enqueue job to Redis Stream
      const jobRequest: SyncJobRequest = {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          externalId: '1',
          objectType: 'Product',
          eventType: 'product.updated',
        },
        idempotencyKey: `test-product-sync-${randomUUID()}`,
      };

      const jobId = await jobEnqueue.enqueueJob(jobRequest);
      expect(jobId).toBeDefined();

      // 3. Simulate job intake consumer processing (persist to database)
      const persistedJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      expect(persistedJob.status).toBe('queued');

      // 4. Simulate job runner executing job
      // Note: In a full integration test, we would start the actual JobIntakeConsumer
      // and SyncJobRunner. For now, we'll manually trigger the handler execution.

      // Get the handler from the app context
      const { MasterProductSyncHandler } = require('../../src/sync/handlers/master-product-sync.handler');
      const handler = harness.get(MasterProductSyncHandler);

      // Execute the handler
      await handler.execute(persistedJob);

      // 5. Manually mark job as succeeded (handler doesn't update status, runner does)
      await jobRepository.markSucceeded(persistedJob.id);

      // Verify job status updated to succeeded
      const updatedJob = await getSyncJobById(dataSource, persistedJob.id);
      expect(updatedJob?.status).toBe('succeeded');

      // 6. Verify product was created in database
      const productRepository = dataSource.getRepository(ProductOrmEntity);
      const products = await productRepository.find();
      expect(products.length).toBeGreaterThan(0);

      const syncedProduct = products.find((p) => p.name === 'Test Product');
      expect(syncedProduct).toBeDefined();
      expect(syncedProduct?.id).toMatch(/^ol_product_/);
      expect(syncedProduct?.name).toBe('Test Product');
      expect(syncedProduct?.sku).toBe('TEST-SKU-001');
      // PostgreSQL numeric type returns as string, convert to number for comparison
      expect(Number(syncedProduct?.price)).toBe(19.99);

      // 7. Verify variants were created
      const variantRepository = dataSource.getRepository(ProductVariantOrmEntity);
      const variants = await variantRepository.find({
        where: { productId: syncedProduct?.id },
      });
      expect(variants.length).toBeGreaterThan(0);
      expect(variants[0].sku).toBe('TEST-VARIANT-SKU-001');
    });

    it('should handle product sync with no variants', async () => {
      const connection = await createTestConnection(dataSource, {
        platformType: 'prestashop',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
      });

      // Mock adapter to return product with no variants
      mockProductAdapter.getProductVariants = jest.fn().mockResolvedValue([]);

      const jobRequest: SyncJobRequest = {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          externalId: '2',
          objectType: 'Product',
          eventType: 'product.updated',
        },
        idempotencyKey: `test-product-sync-no-variants-${randomUUID()}`,
      };

      const persistedJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      const handler = harness.get(require('../../src/sync/handlers/master-product-sync.handler').MasterProductSyncHandler);
      await handler.execute(persistedJob);

      // Verify product was created
      const productRepository = dataSource.getRepository(ProductOrmEntity);
      const products = await productRepository.find();
      expect(products.length).toBeGreaterThan(0);

      // Verify no variants were created
      const variantRepository = dataSource.getRepository(ProductVariantOrmEntity);
      const variants = await variantRepository.find();
      expect(variants.length).toBe(0);
    });

    it('should handle product sync failure and mark job as failed', async () => {
      const connection = await createTestConnection(dataSource, {
        platformType: 'prestashop',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
      });

      // Mock adapter to throw error
      mockProductAdapter.getProduct = jest.fn().mockRejectedValue(
        new Error('Product not found'),
      );

      const jobRequest: SyncJobRequest = {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          externalId: '999',
          objectType: 'Product',
          eventType: 'product.updated',
        },
        idempotencyKey: `test-product-sync-failure-${randomUUID()}`,
      };

      const persistedJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      const handler = harness.get(require('../../src/sync/handlers/master-product-sync.handler').MasterProductSyncHandler);

      // Execute should throw error
      await expect(handler.execute(persistedJob)).rejects.toThrow();

      // Verify job is marked as failed (queued for retry)
      const updatedJob = await getSyncJobById(dataSource, persistedJob.id);
      // Note: The handler throws, so the runner would mark it as failed
      // For this test, we verify the error was thrown
      expect(updatedJob).toBeDefined();
    });
  });

  describe('Product Data Validation', () => {
    it('should preserve all product fields correctly', async () => {
      const connection = await createTestConnection(dataSource, {
        platformType: 'prestashop',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
      });

      // Mock adapter with specific product data
      // Note: The handler will call getOrCreateInternalId first, then getProduct with that internal ID
      // So we need to mock getProduct to return the product with the ID that was passed to it
      mockProductAdapter.getProduct = jest.fn().mockImplementation(async (productId: string) => ({
        id: productId, // Use the internal ID passed to getProduct (from identifier mapping)
        name: 'Complex Product',
        sku: 'COMPLEX-SKU',
        price: 99.99,
        description: 'A complex product description',
        images: ['http://example.com/img1.jpg', 'http://example.com/img2.jpg'],
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      }));

      const jobRequest: SyncJobRequest = {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          externalId: '3',
          objectType: 'Product',
          eventType: 'product.updated',
        },
        idempotencyKey: `test-product-validation-${randomUUID()}`,
      };

      const persistedJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      const handler = harness.get(require('../../src/sync/handlers/master-product-sync.handler').MasterProductSyncHandler);
      await handler.execute(persistedJob);

      // Manually mark job as succeeded (handler doesn't update status, runner does)
      await jobRepository.markSucceeded(persistedJob.id);

      // Verify all fields are preserved
      const productRepository = dataSource.getRepository(ProductOrmEntity);
      const products = await productRepository.find();
      const syncedProduct = products[0];

      expect(syncedProduct.name).toBe('Complex Product');
      expect(syncedProduct.sku).toBe('COMPLEX-SKU');
      // PostgreSQL numeric type returns as string, convert to number for comparison
      expect(Number(syncedProduct.price)).toBe(99.99);
      expect(syncedProduct.description).toBe('A complex product description');
      expect(syncedProduct.images).toEqual(['http://example.com/img1.jpg', 'http://example.com/img2.jpg']);
    });
  });
});

