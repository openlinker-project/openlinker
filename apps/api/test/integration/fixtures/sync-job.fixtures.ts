/**
 * Sync Job Test Fixtures
 *
 * Factory helpers for seeding sync_jobs rows in integration tests.
 *
 * @module apps/api/test/integration/fixtures
 */
import { DataSource } from 'typeorm';
import { SyncJobOrmEntity } from '@openlinker/core/sync';

/**
 * Seed a sync job row directly in the database.
 */
export async function createTestSyncJob(
  dataSource: DataSource,
  overrides?: Partial<SyncJobOrmEntity>,
): Promise<SyncJobOrmEntity> {
  const repo = dataSource.getRepository(SyncJobOrmEntity);

  const entity = repo.create({
    jobType: 'master.inventory.syncAll',
    connectionId: '00000000-0000-0000-0000-000000000001',
    payloadJson: {},
    status: 'queued',
    idempotencyKey: `test-key-${Date.now()}-${Math.random()}`,
    attempts: 0,
    maxAttempts: 3,
    nextRunAt: new Date(),
    ...overrides,
  });

  return repo.save(entity);
}
