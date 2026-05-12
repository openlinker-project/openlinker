/**
 * Sync Job Test Helpers
 *
 * Utilities for creating and querying sync jobs in integration tests.
 *
 * @module apps/worker/test/integration/helpers
 */
import { DataSource } from 'typeorm';
import { SyncJobOrmEntity } from '@openlinker/core/sync/orm-entities';
import { JobStatus } from '@openlinker/core/sync';
import { randomUUID } from 'crypto';

/**
 * Create a test sync job in the database
 *
 * Helper to create a sync job entity directly in the database for testing.
 */
export async function createTestSyncJob(
  dataSource: DataSource,
  overrides?: Partial<SyncJobOrmEntity>,
): Promise<SyncJobOrmEntity> {
  const repository = dataSource.getRepository(SyncJobOrmEntity);

  const job = repository.create({
    id: randomUUID(),
    jobType: 'master.product.syncByExternalId',
    connectionId: randomUUID(),
    payloadJson: { schemaVersion: 1, externalId: '1', objectType: 'Product' },
    status: 'queued',
    idempotencyKey: `test-key-${randomUUID()}`,
    attempts: 0,
    maxAttempts: 10,
    nextRunAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    ...overrides,
  });

  return repository.save(job);
}

/**
 * Get sync job by ID from database
 */
export async function getSyncJobById(
  dataSource: DataSource,
  id: string,
): Promise<SyncJobOrmEntity | null> {
  return dataSource.getRepository(SyncJobOrmEntity).findOne({
    where: { id },
  });
}

/**
 * Get sync job by idempotency key from database
 */
export async function getSyncJobByIdempotencyKey(
  dataSource: DataSource,
  idempotencyKey: string,
): Promise<SyncJobOrmEntity | null> {
  return dataSource.getRepository(SyncJobOrmEntity).findOne({
    where: { idempotencyKey },
  });
}

/**
 * Get all sync jobs from database
 */
export async function getAllSyncJobs(
  dataSource: DataSource,
): Promise<SyncJobOrmEntity[]> {
  return dataSource.getRepository(SyncJobOrmEntity).find({
    order: { createdAt: 'DESC' },
  });
}

/**
 * Get sync jobs by status
 */
export async function getSyncJobsByStatus(
  dataSource: DataSource,
  status: JobStatus,
): Promise<SyncJobOrmEntity[]> {
  return dataSource.getRepository(SyncJobOrmEntity).find({
    where: { status },
    order: { createdAt: 'DESC' },
  });
}

