/**
 * Connection Test Helpers
 *
 * Utilities for creating test connections in worker integration tests.
 *
 * @module apps/worker/test/integration/helpers
 */
import { DataSource } from 'typeorm';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping';

/**
 * Create a test connection in the database
 *
 * Helper to create a connection entity directly in the database for testing.
 */
export async function createTestConnection(
  dataSource: DataSource,
  overrides?: Partial<ConnectionOrmEntity>,
): Promise<ConnectionOrmEntity> {
  const repository = dataSource.getRepository(ConnectionOrmEntity);

  const connection = repository.create({
    platformType: 'prestashop',
    name: 'Test Connection',
    status: 'active',
    config: { baseUrl: 'http://localhost:8080', preferredLanguageId: 1 },
    credentialsRef: 'test-credentials-ref',
    adapterKey: 'prestashop.webservice.v1',
    ...overrides,
  });

  return repository.save(connection);
}

