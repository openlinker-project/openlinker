/**
 * Analytics Trust Read API Integration Test
 *
 * Vertical slice for GET /analytics/trust (#1982): proves the real DI
 * wiring (IIntegrationsService → ISyncJobsService → SchedulerTaskRegistryService)
 * and the real Postgres ordering (`findLastSucceededByConnectionAndJobType`
 * orders by `updatedAt DESC`) that unit tests mock away.
 *
 * The shared test harness disables every plugin's real scheduler tasks
 * (`OL_ALLEGRO_POLL_SCHEDULER_ENABLED=false` etc., see setup.ts) to keep
 * integration tests from making real external calls — which means the real
 * `allegro-orders-poll` / `prestashop-orders-poll` tasks are never *enabled*
 * here, even though they ARE registered. This spec deliberately exploits
 * that split for two different scenarios:
 *
 * - For "cadence known" scenarios it registers its own synthetic, always-
 *   enabled `SchedulerTaskConfig` for `platformType: 'allegro'` (same
 *   registration seam every plugin uses at boot, just invoked from the
 *   test), so those assertions don't depend on the disabled real task.
 * - For the "no enabled task" regression scenario it deliberately does
 *   NOT register a synthetic task for `platformType: 'prestashop'` — the
 *   real `prestashop-orders-poll` task IS registered by the plugin, but is
 *   disabled by the harness. This is exactly the runtime shape a
 *   webhook-first PrestaShop connection has in production, and is the
 *   configuration that would have caught this feature's original bug: a
 *   disabled poll task must never suppress the sync-job lookup itself.
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

const ALLEGRO_ORDERS_POLL_CRON = '*/5 * * * *'; // 5 min * 3 = 15 min, floored up to the 30-min MIN_STALE_THRESHOLD_MS.
const EXPECTED_STALE_AFTER_MS = 30 * 60 * 1000;

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

    // Register a synthetic orders-poll task so this spec's cadence-bearing
    // assertions don't depend on the env-var-gated real Allegro task
    // (disabled globally for the whole integration suite, see setup.ts).
    // Deliberately NOT registering one for 'prestashop' — see the
    // "no enabled task" scenario below.
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
      expect(response.body.worstStatus).toBe('fresh');
      expect(response.body.generatedAt).toBeDefined();
    });

    it('should report never-ingested for a connection with no succeeded poll job', async () => {
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
      expect(entry.lastPollAt).toBeNull();
      expect(entry.lastOrderIngestedAt).toBeNull();
      expect(entry.connectionCreatedAt).toBe(connection.createdAt.toISOString());
      expect(entry.expectedIntervalMs).toBe(5 * 60 * 1000);
      expect(entry.staleAfterMs).toBe(EXPECTED_STALE_AFTER_MS);
    });

    it('should report stalled when the last succeeded poll is older than the floored staleness threshold', async () => {
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
      const staleTimestamp = new Date(Date.now() - 60 * 60 * 1000); // 1h ago, threshold is 30min
      await setSyncJobUpdatedAt(harness, job.id, staleTimestamp);

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entry = response.body.connections[0];
      expect(entry.status).toBe('stalled');
      expect(response.body.worstStatus).toBe('stalled');
      expect(new Date(entry.lastPollAt).getTime()).toBe(staleTimestamp.getTime());
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
      const recentTimestamp = new Date(Date.now() - 2 * 60 * 1000); // 2min ago, threshold is 30min
      await setSyncJobUpdatedAt(harness, job.id, recentTimestamp);

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entry = response.body.connections[0];
      expect(entry.status).toBe('fresh');
      expect(new Date(entry.lastPollAt).getTime()).toBe(recentTimestamp.getTime());
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
      // also be within the 30min threshold, so this also implicitly proves
      // the *newer* row won, not just "some" row).
      expect(new Date(entry.lastPollAt).getTime()).toBe(newerTimestamp.getTime());
      expect(entry.status).toBe('fresh');
    });

    it('should report a recent order-sync job as lastOrderIngestedAt independently of poll status', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createTestConnection(dataSource, {
        platformType: 'allegro',
        adapterKey: 'allegro.publicapi.v1',
        enabledCapabilities: ['OrderSource'],
      });
      const orderSyncJob = await createTestSyncJob(dataSource, {
        connectionId: connection.id,
        jobType: 'marketplace.order.sync',
        status: 'succeeded',
      });
      // Old enough that IF this were read as the poll signal it would be
      // 'stalled' — proving lastOrderIngestedAt is reported independently
      // of, and never conflated with, poll-derived status.
      const orderSyncTimestamp = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await setSyncJobUpdatedAt(harness, orderSyncJob.id, orderSyncTimestamp);

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entry = response.body.connections[0];
      expect(entry.lastPollAt).toBeNull();
      expect(new Date(entry.lastOrderIngestedAt).getTime()).toBe(orderSyncTimestamp.getTime());
      // No poll job ever succeeded — still never-ingested (the poll-pipe
      // liveness reading), even though real order data has arrived.
      expect(entry.status).toBe('never-ingested');
    });

    it('should still report a succeeded poll job when no scheduler task is enabled for the platform (regression for the original disabled-poll bug)', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // 'prestashop' has a REAL registered orders-poll task (unlike a made-up
      // platform), but the harness disables it (OL_PRESTASHOP_POLL_SCHEDULER_ENABLED=false,
      // setup.ts) and this spec does not register a synthetic override for
      // it — exactly the shape of a webhook-first PrestaShop deployment.
      const connection = await createTestConnection(dataSource, {
        platformType: 'prestashop',
        adapterKey: 'prestashop.webservice.v1',
        enabledCapabilities: ['OrderSource'],
      });
      const job = await createTestSyncJob(dataSource, {
        connectionId: connection.id,
        jobType: 'marketplace.orders.poll',
        status: 'succeeded',
      });
      const recentTimestamp = new Date(Date.now() - 2 * 60 * 1000);
      await setSyncJobUpdatedAt(harness, job.id, recentTimestamp);

      const response = await http
        .get('/v1/analytics/trust')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entry = response.body.connections.find(
        (c: { connectionId: string }) => c.connectionId === connection.id,
      );
      expect(entry).toBeDefined();
      // The job lookup must never be gated on a task being registered AND
      // enabled — the evidence (the succeeded job) and the cadence (used
      // only for the threshold) are independent facts.
      expect(new Date(entry.lastPollAt).getTime()).toBe(recentTimestamp.getTime());
      expect(entry.status).toBe('fresh');
      expect(entry.expectedIntervalMs).toBeNull();
      expect(entry.staleAfterMs).toBeNull();
    });

    it('should return 401 without a token', async () => {
      const http = harness.getHttp();
      await http.get('/v1/analytics/trust').expect(401);
    });
  });
});
