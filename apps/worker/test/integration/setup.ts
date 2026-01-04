/**
 * Worker Integration Test Harness
 *
 * Provides a reusable foundation for all worker integration tests. Manages Testcontainers
 * (Postgres + Redis), boots Nest application context (no HTTP server), runs migrations,
 * and provides utilities for test execution.
 *
 * @module apps/worker/test/integration
 */
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { RedisClientType } from 'redis';

/**
 * Worker Integration Test Harness
 *
 * Manages test infrastructure: containers, Nest app context, database, Redis.
 * Note: Worker uses application context (no HTTP server), unlike API tests.
 */
export class WorkerIntegrationTestHarness {
  private appContext?: INestApplicationContext;
  private dataSource?: DataSource;
  private redisClient?: RedisClientType;

  /**
   * Set up test infrastructure
   *
   * Boots Nest app context and runs migrations.
   * Note: Containers are started by globalSetup (harness.ts), not here.
   */
  async setup(): Promise<void> {
    // Containers are already started by globalSetup (harness.ts)
    // Environment variables are already set by globalSetup
    // We just need to boot the Nest application context

    // Create Nest application context (no HTTP server for worker)
    this.appContext = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn', 'log'],
    });

    // 5. Get DataSource for migrations and cleanup
    // DataSource is provided by TypeORM, we need to get it via getDataSourceToken
    const { getDataSourceToken } = require('@nestjs/typeorm');
    const dataSourceToken = getDataSourceToken();
    this.dataSource = this.appContext.get<DataSource>(dataSourceToken);

    // 7. Run migrations (if any exist)
    try {
      const synchronize = this.dataSource.options.synchronize;
      if (!synchronize) {
        await this.dataSource.runMigrations();
      }
    } catch (error: any) {
      // If migrations fail because tables already exist (synchronize=true), that's expected
      if (error?.code !== '42P07' && error?.code !== '42P16') {
        console.warn('Migration error (non-critical):', error.message);
      }
    }

    // 8. Get Redis client for cleanup
    try {
      this.redisClient = this.appContext.get<RedisClientType>('REDIS_CLIENT');
    } catch (error) {
      console.warn('Redis client not available:', error);
    }
  }

  /**
   * Reset database and cache between tests
   *
   * Truncates all tables and clears Redis cache.
   */
  async reset(): Promise<void> {
    if (!this.dataSource) {
      throw new Error('Harness not initialized. Call setup() first.');
    }

    // Truncate all tables (in correct order due to foreign keys)
    // Note: Order matters - child tables first, then parent tables
    await this.dataSource.query('TRUNCATE TABLE sync_jobs CASCADE');
    await this.dataSource.query('TRUNCATE TABLE inventory_items CASCADE');
    await this.dataSource.query('TRUNCATE TABLE product_variants CASCADE');
    await this.dataSource.query('TRUNCATE TABLE products CASCADE');
    await this.dataSource.query('TRUNCATE TABLE identifier_mappings CASCADE');
    await this.dataSource.query('TRUNCATE TABLE connections CASCADE');

    // Clear Redis cache and streams
    if (this.redisClient) {
      try {
        await this.redisClient.flushDb();
      } catch (error) {
        console.warn('Failed to flush Redis:', error);
      }
    }
  }

  /**
   * Get Nest application context
   */
  getAppContext(): INestApplicationContext {
    if (!this.appContext) {
      throw new Error('Harness not initialized. Call setup() first.');
    }
    return this.appContext;
  }

  /**
   * Get TypeORM DataSource
   */
  getDataSource(): DataSource {
    if (!this.dataSource) {
      throw new Error('Harness not initialized. Call setup() first.');
    }
    return this.dataSource;
  }

  /**
   * Get Redis client
   */
  getRedisClient(): RedisClientType | undefined {
    return this.redisClient;
  }

  /**
   * Get a service/provider from the application context
   */
  get<T = any>(token: string | symbol | any): T {
    if (!this.appContext) {
      throw new Error('Harness not initialized. Call setup() first.');
    }
    return this.appContext.get<T>(token);
  }

  /**
   * Tear down test infrastructure
   *
   * Closes app context and destroys DataSource.
   * Note: Containers are stopped by globalTeardown (harness.ts), not here.
   */
  async teardown(): Promise<void> {
    // Close app context first
    if (this.appContext) {
      try {
        await this.appContext.close();
      } catch (error) {
        // Ignore errors during teardown
      }
    }

    // Destroy DataSource if it's initialized
    if (this.dataSource && this.dataSource.isInitialized) {
      try {
        await this.dataSource.destroy();
      } catch (error) {
        // Ignore errors during teardown
      }
    }

    // Close Redis client
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch (error) {
        // Ignore errors during teardown
      }
    }

    // Note: Containers are stopped by globalTeardown (harness.ts)
  }
}

// Global harness instance (shared across tests in same file)
// Also stored in Node's global object for teardown access without importing this module
let globalHarness: WorkerIntegrationTestHarness | null = null;

// Store reference in global for teardown access (avoids importing this module during teardown)
if (typeof global !== 'undefined') {
  (global as any).__workerTestHarness = () => globalHarness;
  (global as any).__workerTestHarnessTeardown = async () => {
    if (globalHarness) {
      await globalHarness.teardown();
      globalHarness = null;
    }
  };
}

/**
 * Get or create global test harness
 *
 * Creates harness on first call, reuses on subsequent calls.
 */
export async function getTestHarness(): Promise<WorkerIntegrationTestHarness> {
  if (!globalHarness) {
    globalHarness = new WorkerIntegrationTestHarness();
    await globalHarness.setup();
  }
  return globalHarness;
}

/**
 * Reset global test harness
 *
 * Clears database and cache between tests.
 */
export async function resetTestHarness(): Promise<void> {
  if (globalHarness) {
    await globalHarness.reset();
  }
}

/**
 * Teardown global test harness
 *
 * Cleans up all resources.
 */
export async function teardownTestHarness(): Promise<void> {
  if (globalHarness) {
    await globalHarness.teardown();
    globalHarness = null;
  }
}

