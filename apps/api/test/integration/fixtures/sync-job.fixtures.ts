/**
 * Sync Job Test Fixtures
 *
 * Factory helpers for seeding sync_jobs rows in integration tests.
 *
 * @module apps/api/test/integration/fixtures
 */
import { DataSource } from 'typeorm';
import { SyncJobOrmEntity } from '@openlinker/core/sync/orm-entities';

/**
 * Seed a sync job row directly in the database.
 */
export async function createTestSyncJob(
  dataSource: DataSource,
  overrides?: Partial<SyncJobOrmEntity>,
): Promise<SyncJobOrmEntity> {
  const repo = dataSource.getRepository(SyncJobOrmEntity);

  const entity = repo.create({
    jobType: 'master.inventory.syncByExternalId',
    connectionId: '11111111-1111-4111-8111-111111111111',
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
