/**
 * Connection Test Helpers
 *
 * Utilities for creating test connections in integration tests.
 *
 * @module apps/api/test/integration/helpers
 */
import { DataSource } from 'typeorm';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

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
    config: { baseUrl: 'https://shop.example.com' },
    credentialsRef: 'db:test-credentials-ref',
    adapterKey: 'prestashop.webservice.v1',
    ...overrides,
  });

  return repository.save(connection);
}

/**
 * Create multiple test connections
 *
 * Helper to create multiple connections for testing filtering, etc.
 */
export async function createTestConnections(
  dataSource: DataSource,
  count: number,
  overrides?: Partial<ConnectionOrmEntity>,
): Promise<ConnectionOrmEntity[]> {
  const connections: ConnectionOrmEntity[] = [];

  for (let i = 0; i < count; i++) {
    const connection = await createTestConnection(dataSource, {
      name: `Test Connection ${i + 1}`,
      ...overrides,
    });
    connections.push(connection);
  }

  return connections;
}



