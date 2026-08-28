/**
 * Master Inventory Sync All End-to-End Integration Test
 *
 * Integration test for the fan-out behavior of `master.inventory.syncAll`:
 * 1. Seed identifier mappings for a connection (simulating previously-synced products)
 * 2. Execute MasterInventorySyncAllHandler with a syncAll job
 * 3. Verify one `master.inventory.syncBatch` sub-job is enqueued per PAGE of
 *    mappings (#2648 batched the fan-out: one child carries a page of ids in
 *    `payload.externalIds`, where the pre-batch sweep enqueued one child per id)
 * 4. Verify sub-job idempotency keys are stable (derived from the CYCLE, #2219)
 * 5. Verify a mapping set larger than one budget completes across successive ticks
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  SYNC_JOB_REPOSITORY_TOKEN,
  JOB_ENQUEUE_TOKEN,
  SyncJobRequest,
} from '@openlinker/core/sync';
import { SyncJobRepositoryPort } from '@openlinker/core/sync';
import { JobEnqueuePort } from '@openlinker/core/sync';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
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
    externalIds: string[]
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
        })
      );
    }
  }

  it('enqueues one batch sub-job covering the known product mappings, with a stable idempotency key', async () => {
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

    const {
      MasterInventorySyncAllHandler,
    } = require('../../src/sync/handlers/master-inventory-sync-all.handler');
    const handler = harness.get(MasterInventorySyncAllHandler);

    await handler.execute(outerJob);

    // #2648: one child per PAGE, not per product. The default batch size is far
    // larger than this fixture, so all three ids ride in a single child.
    const subJobCalls = enqueueSpy.mock.calls.filter(
      ([req]) => req.jobType === 'master.inventory.syncBatch'
    );
    expect(subJobCalls).toHaveLength(1);

    const enqueuedExternalIds = [
      ...(subJobCalls[0][0].payload as { externalIds: string[] }).externalIds,
    ].sort();
    expect(enqueuedExternalIds).toEqual([...externalIds].sort());

    // Since #2219 the key embeds the CYCLE, not the outer job id: a resuming tick
    // is a different job, so a job-scoped key would re-enqueue the same child
    // under a fresh key on every overlapping page.
    for (const [req] of subJobCalls) {
      expect(req.idempotencyKey).not.toContain(outerJob.id);
      expect(req.idempotencyKey).toMatch(
        new RegExp(`^master:${connection.id}:inventory:syncBatch:ext-\\d:`)
      );
      expect(req.connectionId).toBe(connection.id);
    }
  });

  it('completes a mapping set larger than one budget across successive ticks', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'prestashop.webservice.v1',
    });

    // 5 mappings, budget of 2 => 3 ticks (2 + 2 + 1).
    const externalIds = ['ext-1', 'ext-2', 'ext-3', 'ext-4', 'ext-5'];
    await seedProductMappings(connection.id, 'prestashop', externalIds);

    const {
      MasterInventorySyncAllHandler,
    } = require('../../src/sync/handlers/master-inventory-sync-all.handler');
    const handler = harness.get(MasterInventorySyncAllHandler);

    const enqueueSpy = jest.spyOn(jobEnqueue, 'enqueueJob');
    const perTickCounts: number[] = [];
    const coveredPerTick: number[] = [];

    // Each tick is a DISTINCT outer job, exactly as the scheduler mints one per
    // cron fire — which is why the child key cannot be job-scoped.
    for (let tick = 0; tick < 3; tick++) {
      const outerJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: 'master.inventory.syncAll',
        connectionId: connection.id,
        payload: { schemaVersion: 1, pageLimit: 2 },
        idempotencyKey: `inventory-sync-all-tick-${String(tick)}-${randomUUID()}`,
        maxAttempts: 3,
      });
      enqueueSpy.mockClear();
      await expect(handler.execute(outerJob)).resolves.toEqual({ outcome: 'ok' });
      const tickChildren = enqueueSpy.mock.calls.filter(
        ([req]) => req.jobType === 'master.inventory.syncBatch'
      );
      perTickCounts.push(tickChildren.length);
      coveredPerTick.push(
        tickChildren.reduce(
          (n, [req]) => n + (req.payload as { externalIds: string[] }).externalIds.length,
          0
        )
      );
    }

    // Budget respected per tick, and the whole set covered across the cycle.
    // One CHILD per tick now (#2648) — the page of 2, 2 then 1 ids rides in one
    // `syncBatch` payload each, so the budget is visible in the ids covered
    // rather than in the child count.
    expect(perTickCounts).toEqual([1, 1, 1]);
    expect(coveredPerTick).toEqual([2, 2, 1]);
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

    const {
      MasterInventorySyncAllHandler,
    } = require('../../src/sync/handlers/master-inventory-sync-all.handler');
    const handler = harness.get(MasterInventorySyncAllHandler);

    await expect(handler.execute(outerJob)).resolves.toEqual({ outcome: 'ok' });

    const subJobCalls = enqueueSpy.mock.calls.filter(
      ([req]) => req.jobType === 'master.inventory.syncBatch'
    );
    expect(subJobCalls).toHaveLength(0);
  });
});
