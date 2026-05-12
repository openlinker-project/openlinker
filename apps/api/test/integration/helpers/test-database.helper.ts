/**
 * Database Test Helpers
 *
 * Utilities for database operations in integration tests.
 *
 * @module apps/api/test/integration/helpers
 */
import { DataSource } from 'typeorm';
import { ConnectionOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

/**
 * Truncate all test tables
 *
 * Clears all data from test database tables.
 */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  // Truncate in correct order (respecting foreign keys)
  await dataSource.query('TRUNCATE TABLE identifier_mappings CASCADE');
  await dataSource.query('TRUNCATE TABLE connections CASCADE');
  await dataSource.query('TRUNCATE TABLE users CASCADE');
}

/**
 * Get connection by ID from database
 *
 * Direct database query for assertions.
 */
export async function getConnectionById(
  dataSource: DataSource,
  id: string,
): Promise<ConnectionOrmEntity | null> {
  return dataSource.getRepository(ConnectionOrmEntity).findOne({
    where: { id },
  });
}

/**
 * Get all connections from database
 *
 * Direct database query for assertions.
 */
export async function getAllConnections(
  dataSource: DataSource,
): Promise<ConnectionOrmEntity[]> {
  return dataSource.getRepository(ConnectionOrmEntity).find();
}

/**
 * Count connections in database
 *
 * Direct database query for assertions.
 */
export async function countConnections(
  dataSource: DataSource,
): Promise<number> {
  return dataSource.getRepository(ConnectionOrmEntity).count();
}
