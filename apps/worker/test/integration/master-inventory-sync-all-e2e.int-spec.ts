/**
 * Master Inventory Sync All End-to-End Integration Test
 *
 * Integration test for the fan-out behavior of `master.inventory.syncAll`:
 * 1. Seed identifier mappings for a connection (simulating previously-synced products)
 * 2. Execute MasterInventorySyncAllHandler with a syncAll job
 * 3. Verify one `master.inventory.syncByExternalId` sub-job is enqueued per mapping
 * 4. Verify sub-job idempotency keys are stable (derived from outer job id)
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { SYNC_JOB_REPOSITORY_TOKEN, JOB_ENQUEUE_TOKEN, SyncJobRequest } from '@openlinker/core/sync';
import { SyncJobRepositoryPort } from '@openlinker/core/sync/domain/ports/sync-job-repository.port';
import { JobEnqueuePort } from '@openlinker/core/sync/domain/ports/job-enqueue.port';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

describe('Master Inventory Sync All End-to-End Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: SyncJobRepositoryPort;
  let jobEnqueue: JobEnqueuePort;
  let dataSource: DataSource;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    dataSource = harness.getDataSource();
  });

  beforeEach(async () => {
    await resetTestHarness();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedProductMappings(
    connectionId: string,
    platformType: string,
    externalIds: string[],
  ): Promise<void> {
    const repo = dataSource.getRepository(IdentifierMappingOrmEntity);
    for (const externalId of externalIds) {
      await repo.save(
        repo.create({
          entityType: 'Product',
          internalId: `ol_product_${randomUUID().replace(/-/g, '')}`,
          externalId,
          platformType,
          connectionId,
          context: null,
        }),
      );
    }
  }

  it('enqueues one sub-job per known product mapping and uses stable idempotency keys', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'prestashop.webservice.v1',
    });

    const externalIds = ['ext-1', 'ext-2', 'ext-3'];
    await seedProductMappings(connection.id, 'prestashop', externalIds);

    const syncAllRequest: SyncJobRequest = {
      jobType: 'master.inventory.syncAll',
      connectionId: connection.id,
      payload: { schemaVersion: 1 },
      idempotencyKey: `inventory-sync-all-${randomUUID()}`,
    };

    const outerJob = await jobRepository.createIfNotExistsByIdempotencyKey({
      jobType: syncAllRequest.jobType,
      connectionId: syncAllRequest.connectionId,
      payload: syncAllRequest.payload,
      idempotencyKey: syncAllRequest.idempotencyKey,
      maxAttempts: 3,
    });

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');

    const { MasterInventorySyncAllHandler } = require('../../src/sync/handlers/master-inventory-sync-all.handler');
    const handler = harness.get(MasterInventorySyncAllHandler);

    await handler.execute(outerJob);

    const subJobCalls = enqueueSpy.mock.calls.filter(
      ([req]) => req.jobType === 'master.inventory.syncByExternalId',
    );
    expect(subJobCalls).toHaveLength(externalIds.length);

    const enqueuedExternalIds = subJobCalls.map(([req]) => (req.payload as { externalId: string }).externalId).sort();
    expect(enqueuedExternalIds).toEqual([...externalIds].sort());

    // Every sub-job idempotency key embeds the outer job id, so re-running the
    // same outer job produces identical keys (queue dedupe handles the rest).
    for (const [req] of subJobCalls) {
      expect(req.idempotencyKey).toContain(outerJob.id);
      expect(req.connectionId).toBe(connection.id);
    }
  });

  it('is a no-op when no product mappings exist for the connection', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'prestashop.webservice.v1',
    });

    const outerJob = await jobRepository.createIfNotExistsByIdempotencyKey({
      jobType: 'master.inventory.syncAll',
      connectionId: connection.id,
      payload: { schemaVersion: 1 },
      idempotencyKey: `inventory-sync-all-empty-${randomUUID()}`,
      maxAttempts: 3,
    });

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');

    const { MasterInventorySyncAllHandler } = require('../../src/sync/handlers/master-inventory-sync-all.handler');
    const handler = harness.get(MasterInventorySyncAllHandler);

    await expect(handler.execute(outerJob)).resolves.toBeUndefined();

    const subJobCalls = enqueueSpy.mock.calls.filter(
      ([req]) => req.jobType === 'master.inventory.syncByExternalId',
    );
    expect(subJobCalls).toHaveLength(0);
  });
});
