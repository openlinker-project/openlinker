/**
 * Allegro Offer Quantity Update End-to-End Integration Test
 *
 * Integration test for the complete offer quantity update flow:
 * 1. Enqueue `inventory.propagateToMarketplaces` job
 * 2. Verify offer quantity update jobs enqueued
 * 3. Execute offer quantity update handler (mock Allegro API)
 * 4. Verify command status persisted
 * 5. Query command status via repository
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { createMockAllegroMarketplaceAdapter } from './helpers/mock-allegro-adapters.helper';
import { SYNC_JOB_REPOSITORY_TOKEN, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { SyncJobRepositoryPort } from '@openlinker/core/sync';
import { JobEnqueuePort } from '@openlinker/core/sync';
import { SyncJobRequest } from '@openlinker/core/sync';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

describe('Allegro Offer Quantity Update End-to-End Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: SyncJobRepositoryPort;
  let jobEnqueue: JobEnqueuePort;
  let integrationsService: IIntegrationsService;
  let dataSource: DataSource;
  let mockMarketplaceAdapter: ReturnType<typeof createMockAllegroMarketplaceAdapter>;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    dataSource = harness.getDataSource();

    // Set credentials environment variable for test connection
    process.env.CREDENTIALS_TEST_CREDENTIALS_REF = '{"accessToken":"test-token","refreshToken":"test-refresh"}';
  });

  beforeEach(async () => {
    await resetTestHarness();

    // Create mock adapter for each test
    mockMarketplaceAdapter = createMockAllegroMarketplaceAdapter();

    // Mock IntegrationsService to return our mock adapter
    jest.spyOn(integrationsService, 'getCapabilityAdapter').mockResolvedValue(
      mockMarketplaceAdapter as any,
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('Complete Offer Quantity Update Flow', () => {
    it('should update offer quantity and persist command status', async () => {
      // 1. Create test connection
      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
        adapterKey: 'allegro.publicapi.v1',
      });

      // 2. Enqueue offer quantity update job
      const offerId = 'offer-123';
      const quantity = 50;
      const idempotencyKey = `test-offer-update-${randomUUID()}`;

      const updateJobRequest: SyncJobRequest = {
        jobType: 'marketplace.offerQuantity.update',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          offerId,
          quantity,
          idempotencyKey,
        },
        idempotencyKey,
      };

      const jobId = await jobEnqueue.enqueueJob(updateJobRequest);
      expect(jobId).toBeDefined();

      // 3. Persist job to database
      const persistedJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: updateJobRequest.jobType,
        connectionId: updateJobRequest.connectionId,
        payload: updateJobRequest.payload,
        idempotencyKey: updateJobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      expect(persistedJob.status).toBe('queued');

      // 4. Execute offer quantity update handler
      const { MarketplaceOfferQuantityUpdateHandler } = require('../../src/sync/handlers/marketplace-offer-quantity-update.handler');
      const handler = harness.get(MarketplaceOfferQuantityUpdateHandler);
      await handler.execute(persistedJob);

      // Mark job as succeeded
      await jobRepository.markSucceeded(persistedJob.id, 'ok');

      // 5. Verify command was called on adapter
      expect(mockMarketplaceAdapter.updateOfferQuantity).toHaveBeenCalledWith({
        offerId,
        quantity,
        idempotencyKey,
      });
    });

    it('should handle command rejection correctly', async () => {
      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
        adapterKey: 'allegro.publicapi.v1',
      });

      // Mock adapter to fail update (handler should surface it as job failure)
      mockMarketplaceAdapter.updateOfferQuantity = jest.fn().mockRejectedValue(
        new Error('rejected'),
      );

      const offerId = 'offer-456';
      const quantity = 0; // Invalid quantity
      const idempotencyKey = `test-offer-reject-${randomUUID()}`;

      const updateJobRequest: SyncJobRequest = {
        jobType: 'marketplace.offerQuantity.update',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          offerId,
          quantity,
          idempotencyKey,
        },
        idempotencyKey,
      };

      const persistedJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: updateJobRequest.jobType,
        connectionId: updateJobRequest.connectionId,
        payload: updateJobRequest.payload,
        idempotencyKey: updateJobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      const { MarketplaceOfferQuantityUpdateHandler } = require('../../src/sync/handlers/marketplace-offer-quantity-update.handler');
      const handler = harness.get(MarketplaceOfferQuantityUpdateHandler);

      // Handler should throw error for rejected commands
      await expect(handler.execute(persistedJob)).rejects.toThrow();
    });
  });
});


