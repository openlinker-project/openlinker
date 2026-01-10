/**
 * Allegro Order Sync End-to-End Integration Test
 *
 * Integration test for the complete Allegro order sync flow:
 * 1. Enqueue `allegro.orders.poll` job
 * 2. Verify job persisted to database
 * 3. Execute poll handler (mock Allegro API)
 * 4. Verify order sync jobs enqueued
 * 5. Execute order sync handler
 * 6. Verify order routed to OrderProcessorManager
 * 7. Verify cursor updated
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { getSyncJobById, getSyncJobsByStatus, getSyncJobByIdempotencyKey } from './helpers/test-sync-job.helper';
import { createMockAllegroMarketplaceAdapter } from './helpers/mock-allegro-adapters.helper';
import { SYNC_JOB_REPOSITORY_TOKEN, JOB_ENQUEUE_TOKEN, CONNECTION_CURSOR_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { SyncJobRepositoryPort } from '@openlinker/core/sync/domain/ports/sync-job-repository.port';
import { JobEnqueuePort } from '@openlinker/core/sync/domain/ports/job-enqueue.port';
import { ConnectionCursorRepositoryPort } from '@openlinker/core/sync/domain/ports/connection-cursor-repository.port';
import { SyncJobRequest, JobTypeValues } from '@openlinker/core/sync/domain/types/sync-job.types';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations/integrations.tokens';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { ORDER_SYNC_SERVICE_TOKEN } from '@openlinker/core/orders/orders.tokens';
import { IOrderSyncService } from '@openlinker/core/orders/application/interfaces/order-sync.service.interface';
import { OrderProcessorManagerPort } from '@openlinker/core/orders/domain/ports/order-processor-manager.port';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

describe('Allegro Order Sync End-to-End Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: SyncJobRepositoryPort;
  let jobEnqueue: JobEnqueuePort;
  let cursorRepository: ConnectionCursorRepositoryPort;
  let integrationsService: IIntegrationsService;
  let orderSyncService: IOrderSyncService;
  let dataSource: DataSource;
  let mockMarketplaceAdapter: ReturnType<typeof createMockAllegroMarketplaceAdapter>;
  let mockOrderProcessor: jest.Mocked<OrderProcessorManagerPort>;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    cursorRepository = harness.get(CONNECTION_CURSOR_REPOSITORY_TOKEN);
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    orderSyncService = harness.get(ORDER_SYNC_SERVICE_TOKEN);
    dataSource = harness.getDataSource();

    // Set credentials environment variable for test connection
    process.env.CREDENTIALS_TEST_CREDENTIALS_REF = '{"accessToken":"test-token","refreshToken":"test-refresh"}';
  });

  beforeEach(async () => {
    await resetTestHarness();

    // Create mock adapters for each test
    mockMarketplaceAdapter = createMockAllegroMarketplaceAdapter();
    mockOrderProcessor = {
      createOrder: jest.fn().mockResolvedValue({ orderId: randomUUID(), orderNumber: 'PS-ORDER-001' }),
      getOrder: jest.fn(),
      updateOrderStatus: jest.fn(),
      cancelOrder: jest.fn(),
      processReturn: jest.fn(),
      getOrders: jest.fn(),
    } as unknown as jest.Mocked<OrderProcessorManagerPort>;

    // Mock IntegrationsService to return our mock adapters
    jest.spyOn(integrationsService, 'getCapabilityAdapter').mockImplementation(async (connectionId: string, capability: string) => {
      if (capability === 'Marketplace') {
        return mockMarketplaceAdapter as any;
      }
      if (capability === 'OrderProcessorManager') {
        return mockOrderProcessor as any;
      }
      throw new Error(`Unsupported capability: ${capability}`);
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('Complete Order Sync Flow', () => {
    it('should sync orders from poll to order processor', async () => {
      // 1. Create test connection
      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
        adapterKey: 'allegro.publicapi.v1',
      });

      // 2. Enqueue poll job to Redis Stream
      const pollJobRequest: SyncJobRequest = {
        jobType: 'allegro.orders.poll' as JobTypeValues[number],
        connectionId: connection.id,
        payload: {
          cursorKey: 'allegro.orders.lastEventId',
          limit: 10,
        },
        idempotencyKey: `test-allegro-poll-${randomUUID()}`,
      };

      const pollJobId = await jobEnqueue.enqueueJob(pollJobRequest);
      expect(pollJobId).toBeDefined();

      // 3. Persist poll job to database
      const persistedPollJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: pollJobRequest.jobType,
        connectionId: pollJobRequest.connectionId,
        payload: pollJobRequest.payload,
        idempotencyKey: pollJobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      expect(persistedPollJob.status).toBe('queued');

      // 4. Execute poll handler
      const { AllegroOrdersPollHandler } = require('../../src/sync/handlers/allegro-orders-poll.handler');
      const pollHandler = harness.get(AllegroOrdersPollHandler);
      await pollHandler.execute(persistedPollJob);

      // Mark poll job as succeeded
      await jobRepository.markSucceeded(persistedPollJob.id);

      // 5. Verify order sync jobs were enqueued
      const allJobs = await jobRepository.find({ connectionId: connection.id });
      const orderSyncJobs = allJobs.filter((job) => job.jobType === 'allegro.order.syncByCheckoutFormId');
      expect(orderSyncJobs.length).toBeGreaterThan(0);

      // 6. Execute order sync handler for first order
      const orderSyncJob = orderSyncJobs[0];
      const { AllegroOrderSyncHandler } = require('../../src/sync/handlers/allegro-order-sync.handler');
      const orderSyncHandler = harness.get(AllegroOrderSyncHandler);
      await orderSyncHandler.execute(orderSyncJob);

      // Mark order sync job as succeeded
      await jobRepository.markSucceeded(orderSyncJob.id);

      // 7. Verify order was routed to OrderProcessorManager
      expect(mockOrderProcessor.createOrder).toHaveBeenCalled();
      const createOrderCall = mockOrderProcessor.createOrder.mock.calls[0][0];
      expect(createOrderCall.orderNumber).toBeDefined();
      expect(createOrderCall.items.length).toBeGreaterThan(0);

      // 8. Verify cursor was updated
      const cursor = await cursorRepository.get(connection.id, 'allegro.orders.lastEventId');
      expect(cursor).toBeDefined();
      expect(cursor).not.toBeNull();
    });

    it('should handle cursor persistence correctly', async () => {
      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
        adapterKey: 'allegro.publicapi.v1',
      });

      // Initial poll
      const pollJobRequest: SyncJobRequest = {
        jobType: 'allegro.orders.poll' as JobTypeValues[number],
        connectionId: connection.id,
        payload: {
          cursorKey: 'allegro.orders.lastEventId',
          limit: 10,
        },
        idempotencyKey: `test-poll-1-${randomUUID()}`,
      };

      const persistedPollJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: pollJobRequest.jobType,
        connectionId: pollJobRequest.connectionId,
        payload: pollJobRequest.payload,
        idempotencyKey: pollJobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      const { AllegroOrdersPollHandler } = require('../../src/sync/handlers/allegro-orders-poll.handler');
      const pollHandler = harness.get(AllegroOrdersPollHandler);
      await pollHandler.execute(persistedPollJob);
      await jobRepository.markSucceeded(persistedPollJob.id);

      // Get first cursor
      const firstCursor = await cursorRepository.get(connection.id, 'allegro.orders.lastEventId');
      expect(firstCursor).toBeDefined();

      // Second poll should use the cursor
      const pollJobRequest2: SyncJobRequest = {
        jobType: 'allegro.orders.poll' as JobTypeValues[number],
        connectionId: connection.id,
        payload: {
          cursorKey: 'allegro.orders.lastEventId',
          limit: 10,
        },
        idempotencyKey: `test-poll-2-${randomUUID()}`,
      };

      const persistedPollJob2 = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: pollJobRequest2.jobType,
        connectionId: pollJobRequest2.connectionId,
        payload: pollJobRequest2.payload,
        idempotencyKey: pollJobRequest2.idempotencyKey,
        maxAttempts: 10,
      });

      await pollHandler.execute(persistedPollJob2);
      await jobRepository.markSucceeded(persistedPollJob2.id);

      // Verify cursor advanced
      const secondCursor = await cursorRepository.get(connection.id, 'allegro.orders.lastEventId');
      expect(secondCursor).toBeDefined();
      expect(secondCursor).not.toBe(firstCursor);
    });
  });
});


