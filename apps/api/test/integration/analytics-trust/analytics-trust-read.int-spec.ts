/**
 * Analytics Trust Read API Integration Test
 *
 * Vertical slice for GET /analytics/trust (#1982): proves the real DI
 * wiring (IIntegrationsService → ISyncJobsService → SchedulerTaskRegistryService)
 * and the real Postgres ordering (`findLastSucceededByConnectionAndJobType`
 * orders by `updatedAt DESC`) that unit tests mock away.
 *
 * The shared test harness disables every plugin's real scheduler tasks
 * (`OL_ALLEGRO_POLL_SCHEDULER_ENABLED=false`, see setup.ts) to keep
 * integration tests from making real external calls — which means the real
 * `allegro-orders-poll` task is never registered here. This spec registers
 * its own synthetic `SchedulerTaskConfig` (same jobType, real `'allegro'`
 * platformType so `listCapabilityAdapters` can still resolve the connection's
 * adapter metadata) directly through the same `SchedulerTaskRegistryService`
 * instance the app already uses — the same registration seam every plugin
 * uses at boot, just invoked from the test instead of `onModuleInit`.
 *
 * @module apps/api/test/integration/analytics-trust
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from '../setup';
import type { IntegrationTestHarness } from '../setup';
import { loginAsAdmin } from '../helpers/test-auth.helper';
import { createTestConnection } from '../helpers/test-connection.helper';
import { createTestSyncJob } from '../fixtures/sync-job.fixtures';
import { SCHEDULER_TASK_REGISTRY_TOKEN } from '@openlinker/core/sync';
import type { SchedulerTaskRegistryService } from '@openlinker/core/sync';

const ALLEGRO_ORDERS_POLL_CRON = '*/5 * * * *'; // 5 min -> 15 min stale threshold (3x)

async function setSyncJobUpdatedAt(
  harness: IntegrationTestHarness,
  jobId: string,
  updatedAt: Date,
): Promise<void> {
  await harness
    .getDataSource()
    .query('UPDATE sync_jobs SET "updatedAt" = $1 WHERE id = $2', [updatedAt, jobId]);
}

describe('Analytics Trust Read API Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();

    // Register a synthetic orders-poll task so this spec's assertions don't
    // depend on the env-var-gated real Allegro task (disabled globally for
    // the whole integration suite, see setup.ts).
    const schedulerTaskRegistry = harness.getApp().get<SchedulerTaskRegistryService>(
      SCHEDULER_TASK_REGISTRY_TOKEN,
    );
    schedulerTaskRegistry.register({
      taskId: 'test-analytics-trust-allegro-orders-poll',
      platformType: 'allegro',
      jobType: 'marketplace.orders.poll',
      cronExpression: ALLEGRO_ORDERS_POLL_CRON,
      generatePayload: () => ({}),
      generateIdempotencyKey: () => 'test-analytics-trust',
    });
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('GET /analytics/trust', () => {
    it('should return an empty connections array when no OrderSource connections exist', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.connections).toEqual([]);
      expect(response.body.generatedAt).toBeDefined();
    });

    it('should report never-ingested for a connection with no succeeded ingestion job', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        adapterKey: 'allegro.publicapi.v1',
        enabledCapabilities: ['OrderSource'],
      });

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.connections).toHaveLength(1);
      const entry = response.body.connections[0];
      expect(entry.connectionId).toBe(connection.id);
      expect(entry.platformType).toBe('allegro');
      expect(entry.status).toBe('never-ingested');
      expect(entry.lastSuccessfulIngestionAt).toBeNull();
      expect(entry.coverageStartAt).toBe(connection.createdAt.toISOString());
      expect(entry.expectedIntervalMs).toBe(5 * 60 * 1000);
      expect(entry.staleAfterMs).toBe(15 * 60 * 1000);
    });

    it('should report stalled when the last succeeded poll is older than 3x the platform cadence', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        adapterKey: 'allegro.publicapi.v1',
        enabledCapabilities: ['OrderSource'],
      });
      const job = await createTestSyncJob(dataSource, {
        connectionId: connection.id,
        jobType: 'marketplace.orders.poll',
        status: 'succeeded',
      });
      const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000); // 1h ago, threshold is 15min
      await setSyncJobUpdatedAt(harness, job.id, staleTimestamp);

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entry = response.body.connections[0];
      expect(entry.status).toBe('stalled');
      expect(new Date(entry.lastSuccessfulIngestionAt).getTime()).toBe(staleTimestamp.getTime());
    });

    it('should report fresh when the last succeeded poll is within the platform cadence', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        adapterKey: 'allegro.publicapi.v1',
        enabledCapabilities: ['OrderSource'],
      });
      const job = await createTestSyncJob(dataSource, {
        connectionId: connection.id,
        jobType: 'marketplace.orders.poll',
        status: 'succeeded',
      });
      const recentTimestamp = new Date(Date.now() - 2 * 60 * 1000); // 2min ago, threshold is 15min
      await setSyncJobUpdatedAt(harness, job.id, recentTimestamp);

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entry = response.body.connections[0];
      expect(entry.status).toBe('fresh');
      expect(new Date(entry.lastSuccessfulIngestionAt).getTime()).toBe(recentTimestamp.getTime());
    });

    it('should reflect the most recently succeeded job when several exist (real updatedAt DESC ordering)', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        adapterKey: 'allegro.publicapi.v1',
        enabledCapabilities: ['OrderSource'],
      });

      const olderJob = await createTestSyncJob(dataSource, {
        connectionId: connection.id,
        jobType: 'marketplace.orders.poll',
        status: 'succeeded',
      });
      await setSyncJobUpdatedAt(harness, olderJob.id, new Date(Date.now() - 10 * 60 * 1000));

      const newerJob = await createTestSyncJob(dataSource, {
        connectionId: connection.id,
        jobType: 'marketplace.orders.poll',
        status: 'succeeded',
      });
      const newerTimestamp = new Date(Date.now() - 1 * 60 * 1000);
      await setSyncJobUpdatedAt(harness, newerJob.id, newerTimestamp);

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entry = response.body.connections[0];
      // Must reflect the newer job's timestamp, not the older one's, and
      // therefore 'fresh' (1min ago) rather than 'stalled' (10min ago would
      // also be within the 15min threshold, so this also implicitly proves
      // the *newer* row won, not just "some" row).
      expect(new Date(entry.lastSuccessfulIngestionAt).getTime()).toBe(newerTimestamp.getTime());
      expect(entry.status).toBe('fresh');
    });

    it('should return 401 without a token', async () => {
      const http = harness.getHttp();
      await http.get('/v1/analytics/trust').expect(401);
    });
  });
});
