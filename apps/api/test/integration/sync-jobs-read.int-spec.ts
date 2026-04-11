/**
 * Sync Jobs Read API Integration Test
 *
 * Vertical slice tests for the sync jobs read API:
 * GET /sync/jobs — list with pagination and filters
 * GET /sync/jobs/:id — detail view
 *
 * Uses real Postgres via Testcontainers.
 *
 * @module apps/api/test/integration
 */
import { getTestHarness, IntegrationTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { loginAsAdmin } from './helpers/test-auth.helper';
import { createTestSyncJob } from './fixtures/sync-job.fixtures';

describe('Sync Jobs Read API Integration', () => {
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

  describe('GET /sync/jobs', () => {
    it('should return empty list when no jobs exist', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .get('/sync/jobs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.items).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it('should return seeded sync jobs with correct shape', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const job = await createTestSyncJob(dataSource, {
        jobType: 'master.inventory.syncAll',
        status: 'queued',
      });

      const response = await http
        .get('/sync/jobs')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items).toHaveLength(1);

      const item = response.body.items[0];
      expect(item.id).toBe(job.id);
      expect(item.jobType).toBe('master.inventory.syncAll');
      expect(item.status).toBe('queued');
      expect(item.connectionId).toBeDefined();
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
    });

    it('should filter by status', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestSyncJob(dataSource, { status: 'queued' });
      await createTestSyncJob(dataSource, { status: 'succeeded' });
      await createTestSyncJob(dataSource, { status: 'failed' });

      const response = await http
        .get('/sync/jobs?status=queued')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].status).toBe('queued');
    });

    it('should filter by connectionId', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const targetConnectionId = '00000000-0000-0000-0000-000000000001';
      const otherConnectionId = '00000000-0000-0000-0000-000000000099';

      await createTestSyncJob(dataSource, { connectionId: targetConnectionId });
      await createTestSyncJob(dataSource, { connectionId: otherConnectionId });

      const response = await http
        .get(`/sync/jobs?connectionId=${targetConnectionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].connectionId).toBe(targetConnectionId);
    });

    it('should filter by jobType', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await createTestSyncJob(dataSource, { jobType: 'master.inventory.syncAll' });
      await createTestSyncJob(dataSource, { jobType: 'marketplace.offers.sync' });

      const response = await http
        .get('/sync/jobs?jobType=master.inventory.syncAll')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.total).toBe(1);
      expect(response.body.items[0].jobType).toBe('master.inventory.syncAll');
    });

    it('should paginate results with limit and offset', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      for (let i = 0; i < 5; i++) {
        await createTestSyncJob(dataSource);
      }

      const page1 = await http
        .get('/sync/jobs?limit=2&offset=0')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.total).toBe(5);
      expect(page1.body.limit).toBe(2);
      expect(page1.body.offset).toBe(0);

      const page2 = await http
        .get('/sync/jobs?limit=2&offset=2')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(page2.body.items).toHaveLength(2);
      expect(page2.body.total).toBe(5);

      // Pages must not overlap
      const ids1 = page1.body.items.map((j: { id: string }) => j.id) as string[];
      const ids2 = page2.body.items.map((j: { id: string }) => j.id) as string[];
      expect(ids1.some((id) => ids2.includes(id))).toBe(false);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.get('/sync/jobs').expect(401);
    });
  });

  describe('GET /sync/jobs/:id', () => {
    it('should return sync job detail by id', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const job = await createTestSyncJob(dataSource, { jobType: 'master.inventory.syncAll' });

      const response = await http
        .get(`/sync/jobs/${job.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.id).toBe(job.id);
      expect(response.body.jobType).toBe('master.inventory.syncAll');
      expect(response.body.status).toBe('queued');
    });

    it('should return 404 for non-existent job', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .get('/sync/jobs/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 401 without token', async () => {
      const http = harness.getHttp();
      await http.get('/sync/jobs/00000000-0000-0000-0000-000000000000').expect(401);
    });
  });
});
