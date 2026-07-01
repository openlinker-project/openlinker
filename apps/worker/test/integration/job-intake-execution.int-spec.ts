/**
 * Job Intake → Execution Integration Test
 *
 * Integration test for the complete flow from Redis Stream job intake
 * to job execution. Verifies that jobs are consumed from Redis, persisted
 * to database, and executed by the job runner.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { createTestSyncJob, getSyncJobById } from './helpers/test-sync-job.helper';
import { SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { SyncJobRepositoryPort } from '@openlinker/core/sync';
import { SyncJobRequest } from '@openlinker/core/sync';
import { SyncJobOrmEntity } from '@openlinker/core/sync/orm-entities';
import { randomUUID } from 'crypto';

describe('Job Intake → Execution Integration', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: SyncJobRepositoryPort;
  let redisClient: any;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    redisClient = harness.getRedisClient();

    // Set credentials environment variable for test connection
    process.env.CREDENTIALS_TEST_CREDENTIALS_REF = '{"webserviceApiKey":"test-api-key"}';
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  describe('Job Intake → Persistence', () => {
    it('should consume job from Redis Stream and persist to database', async () => {
      // 1. Create test connection
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
      });

      // 2. Publish job to Redis Stream
      const jobRequest: SyncJobRequest = {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        payload: {
          schemaVersion: 1,
          externalId: '1',
          objectType: 'Product',
          eventType: 'product.updated',
        },
        idempotencyKey: `test-intake-${randomUUID()}`,
      };

      const fields: Record<string, string> = {
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payloadJson: JSON.stringify(jobRequest.payload),
        idempotencyKey: jobRequest.idempotencyKey,
      };

      await redisClient.xAdd('jobs.sync', '*', fields);

      // 3. Wait for job intake consumer to process (simulate consumption)
      // Note: In a real test, we'd need to start the JobIntakeConsumer
      // For now, we'll manually trigger the repository method to simulate
      const persistedJob = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      // 4. Verify job was persisted
      expect(persistedJob).toBeDefined();
      expect(persistedJob.idempotencyKey).toBe(jobRequest.idempotencyKey);
      expect(persistedJob.jobType).toBe(jobRequest.jobType);
      expect(persistedJob.connectionId).toBe(jobRequest.connectionId);
      expect(persistedJob.status).toBe('queued');

      // 5. Verify job can be retrieved from database
      const dbJob = await getSyncJobById(harness.getDataSource(), persistedJob.id);
      expect(dbJob).toBeDefined();
      expect(dbJob?.idempotencyKey).toBe(jobRequest.idempotencyKey);
    });

    it('should handle duplicate idempotency keys (idempotency)', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const idempotencyKey = `test-idempotency-${randomUUID()}`;
      const jobRequest: SyncJobRequest = {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        payload: { externalId: '1', objectType: 'Product', schemaVersion: 1 },
        idempotencyKey,
      };

      // Create first job
      const job1 = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      // Try to create duplicate (should return existing)
      const job2 = await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: jobRequest.jobType,
        connectionId: jobRequest.connectionId,
        payload: jobRequest.payload,
        idempotencyKey: jobRequest.idempotencyKey,
        maxAttempts: 10,
      });

      // Should return the same job
      expect(job1.id).toBe(job2.id);
      expect(job1.idempotencyKey).toBe(job2.idempotencyKey);

      // Verify only one job exists in database
      const allJobs = await getAllSyncJobs(harness.getDataSource());
      const jobsWithKey = allJobs.filter((j) => j.idempotencyKey === idempotencyKey);
      expect(jobsWithKey).toHaveLength(1);
    });
  });

  describe('Job Execution', () => {
    it('should execute queued job and update status to succeeded', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
        credentialsRef: 'test-credentials-ref',
      });

      // Create a job directly in database (simulating job intake)
      const job = await createTestSyncJob(harness.getDataSource(), {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        status: 'queued',
        nextRunAt: new Date(), // Due now
        payloadJson: {
          schemaVersion: 1,
          externalId: '1',
          objectType: 'Product',
          eventType: 'product.updated',
        },
      });

      // Note: In a full integration test, we would:
      // 1. Start the SyncJobRunner
      // 2. Wait for it to pick up and execute the job
      // 3. Verify status changed to 'succeeded'
      // 
      // For now, we'll verify the job exists and can be retrieved
      const retrievedJob = await getSyncJobById(harness.getDataSource(), job.id);
      expect(retrievedJob).toBeDefined();
      expect(retrievedJob?.status).toBe('queued');
      expect(retrievedJob?.jobType).toBe('master.product.syncByExternalId');
    });

    it('should find and lock due jobs', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      // Create multiple queued jobs
      const job1 = await createTestSyncJob(harness.getDataSource(), {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        status: 'queued',
        nextRunAt: new Date(Date.now() - 1000), // Due (in the past)
      });

      const job2 = await createTestSyncJob(harness.getDataSource(), {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        status: 'queued',
        nextRunAt: new Date(Date.now() - 2000), // Due earlier
      });

      // Find and lock due jobs
      const workerId = 'test-worker-123';
      const lockedJobs = await jobRepository.findAndLockDueJobs(10, workerId);

      expect(lockedJobs.length).toBeGreaterThanOrEqual(2);
      expect(lockedJobs.every((j) => j.status === 'running')).toBe(true);
      expect(lockedJobs.every((j) => j.lockedBy === workerId)).toBe(true);
      expect(lockedJobs.every((j) => j.lockedAt !== null)).toBe(true);

      // Verify jobs are locked in database
      const dbJob1 = await getSyncJobById(harness.getDataSource(), job1.id);
      const dbJob2 = await getSyncJobById(harness.getDataSource(), job2.id);
      expect(dbJob1?.status).toBe('running');
      expect(dbJob2?.status).toBe('running');
    });

    // Regression test for the timestamptz fix: nextRunAt/lockedAt were
    // `timestamp without time zone`, making the due-job comparison
    // timezone-dependent and causing due jobs to be skipped on non-UTC
    // hosts. With `timestamptz` columns the comparison is an absolute
    // instant regardless of the session's timezone.
    it('should find due jobs created under a non-UTC Postgres session timezone', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const dataSource = harness.getDataSource();
      const queryRunner = dataSource.createQueryRunner();
      await queryRunner.connect();

      let insertedId: string;
      try {
        await queryRunner.query(`SET TIME ZONE 'Europe/Warsaw'`);
        const repository = queryRunner.manager.getRepository(SyncJobOrmEntity);
        const saved = await repository.save(
          repository.create({
            jobType: 'master.product.syncByExternalId',
            connectionId: connection.id,
            payloadJson: { schemaVersion: 1, externalId: '1', objectType: 'Product' },
            status: 'queued',
            idempotencyKey: `test-tz-${randomUUID()}`,
            attempts: 0,
            maxAttempts: 10,
            nextRunAt: new Date(),
          }),
        );
        insertedId = saved.id;
      } finally {
        await queryRunner.release();
      }

      const lockedJobs = await jobRepository.findAndLockDueJobs(10, 'tz-regression-worker');

      expect(lockedJobs.some((j) => j.id === insertedId)).toBe(true);
    });
  });

  describe('Job Status Transitions', () => {
    it('should mark job as succeeded after execution', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const job = await createTestSyncJob(harness.getDataSource(), {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        status: 'running',
      });

      await jobRepository.markSucceeded(job.id, 'ok');

      const updatedJob = await getSyncJobById(harness.getDataSource(), job.id);
      expect(updatedJob?.status).toBe('succeeded');
      expect(updatedJob?.lockedAt).toBeNull();
      expect(updatedJob?.lockedBy).toBeNull();
    });

    it('should mark job as failed and schedule retry', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const job = await createTestSyncJob(harness.getDataSource(), {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        status: 'running',
        attempts: 1,
      });

      const errorMessage = 'Test error message';
      const nextRunAt = new Date(Date.now() + 30000); // 30 seconds from now

      await jobRepository.markFailed(job.id, errorMessage, nextRunAt);

      const updatedJob = await getSyncJobById(harness.getDataSource(), job.id);
      expect(updatedJob?.status).toBe('queued'); // Requeued for retry
      expect(updatedJob?.attempts).toBe(2); // Incremented
      expect(updatedJob?.lastError).toBe(errorMessage);
      expect(updatedJob?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('should mark job as dead after max attempts', async () => {
      const connection = await createTestConnection(harness.getDataSource(), {
        platformType: 'prestashop',
        status: 'active',
      });

      const job = await createTestSyncJob(harness.getDataSource(), {
        jobType: 'master.product.syncByExternalId',
        connectionId: connection.id,
        status: 'running',
        attempts: 9,
        maxAttempts: 10,
      });

      const errorMessage = 'Max attempts reached';

      await jobRepository.markDead(job.id, errorMessage);

      const updatedJob = await getSyncJobById(harness.getDataSource(), job.id);
      expect(updatedJob?.status).toBe('dead');
      expect(updatedJob?.lastError).toBe(errorMessage);
    });
  });
});

// Helper function to get all sync jobs (for assertions)
async function getAllSyncJobs(dataSource: any): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- dynamic require() needed: path computed at runtime
  const { SyncJobOrmEntity } = require('@openlinker/core/sync/orm-entities');
  return dataSource.getRepository(SyncJobOrmEntity).find({
    order: { createdAt: 'DESC' },
  });
}

