/**
 * Sync Jobs Grouped API Integration Test
 *
 * Vertical slice tests for GET /sync/jobs/grouped — aggregation by
 * (connectionId, jobType). Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { createTestSyncJob } from './fixtures/sync-job.fixtures';

const CONNECTION_A = '11111111-1111-4111-8111-111111111111';
const CONNECTION_B = '22222222-2222-4222-8222-222222222222';

describe('Sync Jobs Grouped API Integration', () => {
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

  describe('GET /sync/jobs/grouped', () => {
    it('should require authentication', async () => {
      const http = harness.getHttp();
      await http.get('/sync/jobs/grouped?status=dead').expect(401);
    });

    it('should return empty groups when no matching jobs exist', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/sync/jobs/grouped?status=dead')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual({ groups: [], totalGroups: 0, totalJobs: 0 });
    });

    it('should collapse same (connectionId, jobType) signature into one group with count', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // Three dead jobs sharing a signature
      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
        lastError: 'oldest',
      });
      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
        lastError: 'middle',
      });
      const newest = await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
        lastError: 'newest',
      });

      const response = await http
        .get('/sync/jobs/grouped?status=dead')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.groups).toHaveLength(1);
      expect(response.body.totalGroups).toBe(1);
      expect(response.body.totalJobs).toBe(3);

      const group = response.body.groups[0];
      expect(group.connectionId).toBe(CONNECTION_A);
      expect(group.jobType).toBe('master.inventory.syncByExternalId');
      expect(group.count).toBe(3);
      expect(group.representativeJobId).toBe(newest.id);
      expect(group.lastError).toBe('newest');
      expect(group.latestUpdatedAt).toBeDefined();
    });

    it('should sort groups by count DESC then latestUpdatedAt DESC', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      // Group 1: 1 job (A + marketplace.order.sync)
      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'marketplace.order.sync',
        status: 'dead',
      });
      // Group 2: 3 jobs (A + master.inventory.syncByExternalId)
      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
      });
      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
      });
      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
      });

      const response = await http
        .get('/sync/jobs/grouped?status=dead')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.groups).toHaveLength(2);
      expect(response.body.groups[0].count).toBe(3);
      expect(response.body.groups[1].count).toBe(1);
      expect(response.body.totalGroups).toBe(2);
      expect(response.body.totalJobs).toBe(4);
    });

    it('should scope by connectionId when provided', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
      });
      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_B,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
      });

      const response = await http
        .get(`/sync/jobs/grouped?status=dead&connectionId=${CONNECTION_A}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.groups).toHaveLength(1);
      expect(response.body.groups[0].connectionId).toBe(CONNECTION_A);
      expect(response.body.totalJobs).toBe(1);
    });

    it('should not return non-matching statuses', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'queued',
      });
      await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'succeeded',
      });

      const response = await http
        .get('/sync/jobs/grouped?status=dead')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.groups).toEqual([]);
      expect(response.body.totalJobs).toBe(0);
    });
  });
});
