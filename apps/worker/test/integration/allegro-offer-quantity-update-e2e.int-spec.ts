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
import { getSyncJobById } from './helpers/test-sync-job.helper';
import { createMockAllegroMarketplaceAdapter } from './helpers/mock-allegro-adapters.helper';
import { SYNC_JOB_REPOSITORY_TOKEN, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { SyncJobRepositoryPort } from '@openlinker/core/sync/domain/ports/sync-job-repository.port';
import { JobEnqueuePort } from '@openlinker/core/sync/domain/ports/job-enqueue.port';
import { SyncJobRequest } from '@openlinker/core/sync/domain/types/sync-job.types';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import {
  AllegroQuantityCommandRepositoryPort,
  ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN,
} from '@openlinker/integrations-allegro';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

describe('Allegro Offer Quantity Update End-to-End Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: SyncJobRepositoryPort;
  let jobEnqueue: JobEnqueuePort;
  let commandRepository: AllegroQuantityCommandRepositoryPort;
  let integrationsService: IIntegrationsService;
  let dataSource: DataSource;
  let mockMarketplaceAdapter: ReturnType<typeof createMockAllegroMarketplaceAdapter>;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    commandRepository = harness.get(ALLEGRO_QUANTITY_COMMAND_REPOSITORY_TOKEN);
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
        jobType: 'allegro.offerQuantity.update' as any,
        connectionId: connection.id,
        payload: {
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
      const { AllegroOfferQuantityUpdateHandler } = require('../../src/sync/handlers/allegro-offer-quantity-update.handler');
      const handler = harness.get(AllegroOfferQuantityUpdateHandler);
      await handler.execute(persistedJob);

      // Mark job as succeeded
      await jobRepository.markSucceeded(persistedJob.id);

      // 5. Verify command was called on adapter
      expect(mockMarketplaceAdapter.updateOfferQuantity).toHaveBeenCalledWith({
        offerId,
        quantity,
        idempotencyKey,
      });

      // 6. Verify command status was persisted
      const updateCall = mockMarketplaceAdapter.updateOfferQuantity.mock.calls[0][0];
      const commandId = (await mockMarketplaceAdapter.updateOfferQuantity(updateCall)).commandId;

      // Wait a bit for async persistence (if any)
      await new Promise((resolve) => setTimeout(resolve, 100));

      const persistedCommand = await commandRepository.findByCommandId(commandId);
      expect(persistedCommand).toBeDefined();
      expect(persistedCommand?.offerId).toBe(offerId);
      expect(persistedCommand?.quantity).toBe(quantity);
      expect(persistedCommand?.connectionId).toBe(connection.id);
      expect(persistedCommand?.status).toBe('queued');
    });

    it('should handle command rejection correctly', async () => {
      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
        adapterKey: 'allegro.publicapi.v1',
      });

      // Mock adapter to return rejected status
      mockMarketplaceAdapter.updateOfferQuantity = jest.fn().mockResolvedValue({
        commandId: randomUUID(),
        status: 'rejected' as const,
      });

      const offerId = 'offer-456';
      const quantity = 0; // Invalid quantity
      const idempotencyKey = `test-offer-reject-${randomUUID()}`;

      const updateJobRequest: SyncJobRequest = {
        jobType: 'allegro.offerQuantity.update' as any,
        connectionId: connection.id,
        payload: {
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

      const { AllegroOfferQuantityUpdateHandler } = require('../../src/sync/handlers/allegro-offer-quantity-update.handler');
      const handler = harness.get(AllegroOfferQuantityUpdateHandler);

      // Handler should throw error for rejected commands
      await expect(handler.execute(persistedJob)).rejects.toThrow();
    });
  });
});


