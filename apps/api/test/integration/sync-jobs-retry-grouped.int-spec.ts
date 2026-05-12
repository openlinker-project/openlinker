/**
 * Sync Jobs Retry Grouped API Integration Test
 *
 * Vertical slice tests for POST /sync/jobs/retry-grouped — bulk re-queue
 * of every dead job matching a (connectionId, jobType) signature. Uses
 * real Postgres via Testcontainers. Event emission is unit-tested on
 * SyncJobBulkRetryService; not re-asserted here.
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
import { SyncJobOrmEntity } from '@openlinker/core/sync/orm-entities';

const CONNECTION_A = '11111111-1111-4111-8111-111111111111';

describe('Sync Jobs Retry Grouped API Integration', () => {
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

  describe('POST /sync/jobs/retry-grouped', () => {
    it('should require authentication', async () => {
      const http = harness.getHttp();
      await http
        .post('/sync/jobs/retry-grouped')
        .send({ connectionId: CONNECTION_A, jobType: 'master.inventory.syncByExternalId' })
        .expect(401);
    });

    it('should 400 on missing body fields', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .post('/sync/jobs/retry-grouped')
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: CONNECTION_A })
        .expect(400);
    });

    it('should 400 on invalid jobType', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      await http
        .post('/sync/jobs/retry-grouped')
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: CONNECTION_A, jobType: 'not.a.real.job.type' })
        .expect(400);
    });

    it('should re-queue every dead job in the group and flip DB state', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const repo = dataSource.getRepository(SyncJobOrmEntity);

      const job1 = await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
        attempts: 10,
        lockedAt: new Date(),
        lockedBy: 'worker-1',
      });
      const job2 = await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
        attempts: 10,
      });
      // Different jobType — should be untouched
      const unrelated = await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'marketplace.order.sync',
        status: 'dead',
        attempts: 10,
      });

      const response = await http
        .post('/sync/jobs/retry-grouped')
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: CONNECTION_A, jobType: 'master.inventory.syncByExternalId' })
        .expect(200);

      expect(response.body.count).toBe(2);
      expect(response.body.skipped).toBe(0);
      expect(response.body.requeuedJobIds).toHaveLength(2);
      expect(new Set(response.body.requeuedJobIds)).toEqual(new Set([job1.id, job2.id]));

      const row1 = await repo.findOneByOrFail({ id: job1.id });
      expect(row1.status).toBe('queued');
      expect(row1.attempts).toBe(0);
      expect(row1.lockedAt).toBeNull();
      expect(row1.lockedBy).toBeNull();

      const row2 = await repo.findOneByOrFail({ id: job2.id });
      expect(row2.status).toBe('queued');
      expect(row2.attempts).toBe(0);

      // Unrelated jobType stays dead
      const unrelatedRow = await repo.findOneByOrFail({ id: unrelated.id });
      expect(unrelatedRow.status).toBe('dead');
      expect(unrelatedRow.attempts).toBe(10);
    });

    it('should return count=0, skipped=0 when no dead jobs match', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);

      const response = await http
        .post('/sync/jobs/retry-grouped')
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: CONNECTION_A, jobType: 'master.inventory.syncByExternalId' })
        .expect(200);

      expect(response.body).toEqual({ requeuedJobIds: [], count: 0, skipped: 0 });
    });

    it('should ignore jobs already in queued or running state', async () => {
      const http = harness.getHttp();
      const dataSource = harness.getDataSource();
      const token = await loginAsAdmin(http, dataSource);
      const repo = dataSource.getRepository(SyncJobOrmEntity);

      const dead = await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'dead',
      });
      const alreadyQueued = await createTestSyncJob(dataSource, {
        connectionId: CONNECTION_A,
        jobType: 'master.inventory.syncByExternalId',
        status: 'queued',
        attempts: 1,
      });

      const response = await http
        .post('/sync/jobs/retry-grouped')
        .set('Authorization', `Bearer ${token}`)
        .send({ connectionId: CONNECTION_A, jobType: 'master.inventory.syncByExternalId' })
        .expect(200);

      expect(response.body.count).toBe(1);
      expect(response.body.requeuedJobIds).toEqual([dead.id]);

      // The already-queued row is untouched (still at attempts=1, not reset)
      const queuedRow = await repo.findOneByOrFail({ id: alreadyQueued.id });
      expect(queuedRow.status).toBe('queued');
      expect(queuedRow.attempts).toBe(1);
    });
  });
});
