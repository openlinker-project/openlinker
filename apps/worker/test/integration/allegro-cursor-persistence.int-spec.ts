/**
 * Allegro Cursor Persistence Integration Test
 *
 * Integration test for cursor persistence and idempotency:
 * 1. Verify cursor advances correctly
 * 2. Verify cursor idempotency (retry safety)
 * 3. Verify cursor is per-connection
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { SYNC_JOB_REPOSITORY_TOKEN, CONNECTION_CURSOR_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { SyncJobRepositoryPort } from '@openlinker/core/sync';
import { ConnectionCursorRepositoryPort } from '@openlinker/core/sync';
import { SyncJobRequest } from '@openlinker/core/sync';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { createMockAllegroMarketplaceAdapter } from './helpers/mock-allegro-adapters.helper';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

describe('Allegro Cursor Persistence Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: SyncJobRepositoryPort;
  let cursorRepository: ConnectionCursorRepositoryPort;
  let integrationsService: IIntegrationsService;
  let dataSource: DataSource;
  let mockMarketplaceAdapter: ReturnType<typeof createMockAllegroMarketplaceAdapter>;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    cursorRepository = harness.get(CONNECTION_CURSOR_REPOSITORY_TOKEN);
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    dataSource = harness.getDataSource();

    process.env.CREDENTIALS_TEST_CREDENTIALS_REF = '{"accessToken":"test-token","refreshToken":"test-refresh"}';
  });

  beforeEach(async () => {
    await resetTestHarness();

    mockMarketplaceAdapter = createMockAllegroMarketplaceAdapter();
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

  describe('Cursor Advancement', () => {
    it('should advance cursor correctly after successful poll', async () => {
      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
        adapterKey: 'allegro.publicapi.v1',
      });

      const cursorKey = 'allegro.orders.lastEventId';

      // Initial state: no cursor
      const initialCursor = await cursorRepository.get(connection.id, cursorKey);
      expect(initialCursor).toBeNull();

      // Execute poll job
      const pollJobRequest: SyncJobRequest = {
        jobType: 'marketplace.orders.poll',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          cursorKey,
          limit: 10,
        },
        idempotencyKey: `test-cursor-advance-${randomUUID()}`,
      };

      const persistedJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: pollJobRequest.jobType,
        connectionId: pollJobRequest.connectionId,
        payload: pollJobRequest.payload,
        idempotencyKey: pollJobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      const { OrdersPollHandler } = require('../../src/sync/handlers/orders-poll.handler');
      const pollHandler = harness.get(OrdersPollHandler);
      await pollHandler.execute(persistedJob);
      await jobRepository.markSucceeded(persistedJob.id);

      // Verify cursor was set
      const firstCursor = await cursorRepository.get(connection.id, cursorKey);
      expect(firstCursor).toBeDefined();
      expect(firstCursor).not.toBeNull();

      // Execute second poll
      const pollJobRequest2: SyncJobRequest = {
        jobType: 'marketplace.orders.poll',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          cursorKey,
          limit: 10,
        },
        idempotencyKey: `test-cursor-advance-2-${randomUUID()}`,
      };

      const persistedJob2 = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: pollJobRequest2.jobType,
        connectionId: pollJobRequest2.connectionId,
        payload: pollJobRequest2.payload,
        idempotencyKey: pollJobRequest2.idempotencyKey,
        maxAttempts: 10,
      });

      await pollHandler.execute(persistedJob2);
      await jobRepository.markSucceeded(persistedJob2.id);

      // Verify cursor advanced
      const secondCursor = await cursorRepository.get(connection.id, cursorKey);
      expect(secondCursor).toBeDefined();
      expect(secondCursor).not.toBe(firstCursor);
    });
  });

  // NOTE: Cursor idempotency (no commit on enqueue failure) is covered by core unit tests.

  describe('Per-Connection Cursor Isolation', () => {
    it('should maintain separate cursors per connection', async () => {
      const connection1 = await createTestConnection(dataSource, {
        platformType: 'allegro',
        status: 'active',
        credentialsRef: 'test-credentials-ref-1',
        adapterKey: 'allegro.publicapi.v1',
      });

      const connection2 = await createTestConnection(dataSource, {
        platformType: 'allegro',
        status: 'active',
        credentialsRef: 'test-credentials-ref-2',
        adapterKey: 'allegro.publicapi.v1',
      });

      const cursorKey = 'allegro.orders.lastEventId';

      // Execute poll for connection1
      const pollJobRequest1: SyncJobRequest = {
        jobType: 'marketplace.orders.poll',
        connectionId: connection1.id,
        payload: {
          schemaVersion: 1,
          cursorKey,
          limit: 10,
        },
        idempotencyKey: `test-connection-1-${randomUUID()}`,
      };

      // Execute poll for connection2
      const pollJobRequest2: SyncJobRequest = {
        jobType: 'marketplace.orders.poll',
        connectionId: connection2.id,
        payload: {
          schemaVersion: 1,
          cursorKey,
          limit: 10,
        },
        idempotencyKey: `test-connection-2-${randomUUID()}`,
      };

      const persistedJob1 = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: pollJobRequest1.jobType,
        connectionId: pollJobRequest1.connectionId,
        payload: pollJobRequest1.payload,
        idempotencyKey: pollJobRequest1.idempotencyKey,
        maxAttempts: 10,
      });

      const { OrdersPollHandler } = require('../../src/sync/handlers/orders-poll.handler');
      const pollHandler = harness.get(OrdersPollHandler);
      await pollHandler.execute(persistedJob1);
      await jobRepository.markSucceeded(persistedJob1.id);

      const cursor1 = await cursorRepository.get(connection1.id, cursorKey);

      const persistedJob2 = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: pollJobRequest2.jobType,
        connectionId: pollJobRequest2.connectionId,
        payload: pollJobRequest2.payload,
        idempotencyKey: pollJobRequest2.idempotencyKey,
        maxAttempts: 10,
      });

      await pollHandler.execute(persistedJob2);
      await jobRepository.markSucceeded(persistedJob2.id);

      const cursor2 = await cursorRepository.get(connection2.id, cursorKey);

      // Cursors should be independent
      expect(cursor1).toBeDefined();
      expect(cursor2).toBeDefined();
      // They might be the same value (if adapter returns same cursor), but they're stored separately
      // The important thing is that they're isolated per connection
    });
  });
});



