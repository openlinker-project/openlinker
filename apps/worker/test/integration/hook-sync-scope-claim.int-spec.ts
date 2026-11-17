/**
 * Hook-sync scope claim + peer claim Integration Test (#3986)
 *
 * Real Postgres proof of the two SQL surfaces the order-priority fix adds:
 * the class-qualified scope exclusion in the lane claim (it must agree with
 * `resolveJobScope`, or saturated scopes silently stop being excluded) and the
 * `FOR UPDATE SKIP LOCKED` peer claim used by the webhook drain.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { createTestSyncJob, getSyncJobById } from './helpers/test-sync-job.helper';
import {
  SYNC_JOB_REPOSITORY_TOKEN,
  SyncJobRepositoryPort,
  resolveJobScope,
} from '@openlinker/core/sync';

describe('Hook-sync scope claim and peer claim (#3986)', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: SyncJobRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const due = (): Date => new Date(Date.now() - 1000);

  it('should exclude hook jobs by the class-qualified scope but keep the same connection orders claimable', async () => {
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const hook = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: due(),
    });
    const order = await createTestSyncJob(dataSource, {
      jobType: 'marketplace.order.sync',
      connectionId: connection.id,
      nextRunAt: due(),
    });

    const hookScope = resolveJobScope({
      connectionId: connection.id,
      jobType: 'master.product.syncByExternalId',
    });
    const locked = await jobRepository.findAndLockDueJobsForLane({
      jobTypes: ['master.product.syncByExternalId', 'marketplace.order.sync'],
      limit: 10,
      workerId: 'w1',
      excludedScopes: [hookScope],
    });

    const ids = locked.map((j) => j.id);
    expect(ids).toContain(order.id);
    expect(ids).not.toContain(hook.id);
    expect((await getSyncJobById(dataSource, hook.id))?.status).toBe('queued');
  });

  it('should keep inventory hook jobs claimable while the product hook scope of the connection is excluded', async () => {
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const product = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: due(),
    });
    const inventory = await createTestSyncJob(dataSource, {
      jobType: 'master.inventory.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: due(),
    });

    const locked = await jobRepository.findAndLockDueJobsForLane({
      jobTypes: ['master.product.syncByExternalId', 'master.inventory.syncByExternalId'],
      limit: 10,
      workerId: 'w1',
      excludedScopes: [
        resolveJobScope({ connectionId: connection.id, jobType: 'master.product.syncByExternalId' }),
      ],
    });

    const ids = locked.map((j) => j.id);
    expect(ids).toContain(inventory.id);
    expect(ids).not.toContain(product.id);
  });

  it('should not exclude hook jobs when only the bare connection id is excluded', async () => {
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const hook = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: due(),
    });

    const locked = await jobRepository.findAndLockDueJobsForLane({
      jobTypes: ['master.product.syncByExternalId'],
      limit: 10,
      workerId: 'w1',
      excludedScopes: [connection.id],
    });

    expect(locked.map((j) => j.id)).toContain(hook.id);
  });

  it('should claim only queued same-type same-connection peers under the claimer worker id', async () => {
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const other = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const claimer = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      status: 'running',
      lockedBy: 'drainer',
      lockedAt: new Date(),
    });
    const peerA = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: due(),
    });
    const peerB = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: due(),
    });
    const otherConnection = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: other.id,
      nextRunAt: due(),
    });
    const otherType = await createTestSyncJob(dataSource, {
      jobType: 'master.inventory.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: due(),
    });
    const future = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: new Date(Date.now() + 60_000),
    });

    const peers = await jobRepository.claimQueuedPeers({
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      limit: 10,
      workerId: 'drainer',
      excludeJobId: claimer.id,
    });

    expect(peers.map((p) => p.id).sort()).toEqual([peerA.id, peerB.id].sort());
    expect(peers.every((p) => p.status === 'running' && p.lockedBy === 'drainer')).toBe(true);
    for (const untouched of [otherConnection, otherType, future]) {
      expect((await getSyncJobById(dataSource, untouched.id))?.status).toBe('queued');
    }
  });

  it('should hand a peer to only one of two concurrent drainers (SKIP LOCKED)', async () => {
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const claimer = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      status: 'running',
    });
    for (let i = 0; i < 6; i += 1) {
      await createTestSyncJob(dataSource, {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        nextRunAt: due(),
      });
    }

    const claim = (workerId: string) =>
      jobRepository.claimQueuedPeers({
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        limit: 10,
        workerId,
        excludeJobId: claimer.id,
      });
    const [a, b] = await Promise.all([claim('w-a'), claim('w-b')]);

    const all = [...a, ...b].map((j) => j.id);
    expect(all).toHaveLength(6);
    expect(new Set(all).size).toBe(6);
  });

  it('should requeue claimed peers through ordinary stuck-job recovery when the claimer dies', async () => {
    const dataSource = harness.getDataSource();
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const claimer = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      status: 'running',
    });
    const peer = await createTestSyncJob(dataSource, {
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      nextRunAt: due(),
    });
    await jobRepository.claimQueuedPeers({
      jobType: 'master.product.syncByExternalId',
      connectionId: connection.id,
      limit: 5,
      workerId: 'dead-worker',
      excludeJobId: claimer.id,
    });

    // Age the lock past the recovery threshold, as a dead claimer would leave it.
    await dataSource.query(`UPDATE sync_jobs SET "lockedAt" = now() - interval '1 hour' WHERE id = $1`, [
      peer.id,
    ]);
    await jobRepository.requeueStuckJobs(15);

    const recovered = await getSyncJobById(dataSource, peer.id);
    expect(recovered?.status).toBe('queued');
    expect(recovered?.attempts).toBe(0);
  });
});
