/**
 * Connection Diagnostics API Integration Test
 *
 * Vertical slice tests for the connection diagnostics endpoint:
 * GET /connections/:id/diagnostics
 *
 * Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';
import { createTestSyncJob } from './fixtures/sync-job.fixtures';

describe('Connection Diagnostics API Integration', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('GET /connections/:id/diagnostics', () => {
    it('should return diagnostics for an active connection', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createTestConnection(dataSource);

      const response = await http
        .get(`/connections/${connection.id}/diagnostics`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toBe(connection.id);
      expect(response.body.platformType).toBe('prestashop');
      expect(response.body.name).toBe('Test Connection');
      expect(response.body.status).toBe('active');
      expect(response.body.recentJobs).toBeDefined();
      expect(Array.isArray(response.body.recentJobs)).toBe(true);
    });

    it('should include recent sync jobs in diagnostics with correct shape', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const connection = await createTestConnection(dataSource);

      // Seed sync jobs for this connection
      await createTestSyncJob(dataSource, {
        connectionId: connection.id,
        jobType: 'master.inventory.syncAll',
        status: 'succeeded',
      });
      await createTestSyncJob(dataSource, {
        connectionId: connection.id,
        jobType: 'marketplace.offers.sync',
        status: 'failed',
      });

      const response = await http
        .get(`/connections/${connection.id}/diagnostics`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.recentJobs).toHaveLength(2);

      // Verify the shape of each job entry matches the FE contract
      const job = response.body.recentJobs[0];
      expect(job.id).toBeDefined();
      expect(job.jobType).toBeDefined();
      expect(job.status).toBeDefined();
      expect(job.connectionId).toBe(connection.id);
      expect(job.createdAt).toBeDefined();
    });

    it('should return 404 for non-existent connection', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get('/connections/00000000-0000-0000-0000-000000000000/diagnostics')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.get('/connections/00000000-0000-0000-0000-000000000000/diagnostics').expect(401);
    });
  });
});
