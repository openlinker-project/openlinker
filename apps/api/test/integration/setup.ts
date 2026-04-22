/**
 * Integration Test Harness
 *
 * Provides a reusable foundation for all integration tests. Manages Testcontainers
 * (Postgres + Redis), boots Nest application, runs migrations, and provides
 * utilities for test execution.
 *
 * @module apps/api/test/integration
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import * as express from 'express';
import { AppModule } from '../../src/app.module';
import { RedisClientType } from 'redis';
import { startHarness } from './harness';

/**
 * Integration Test Harness
 *
 * Manages test infrastructure: containers, Nest app, database, Redis.
 */
export class IntegrationTestHarness {
  private app?: INestApplication;
  private dataSource?: DataSource;
  private redisClient?: RedisClientType;
  private moduleRef?: TestingModule;

  /**
   * Set up test infrastructure
   *
   * Starts containers, boots Nest app, runs migrations.
   */
  async setup(): Promise<void> {
    // 1. Start containers (harness-only, no app imports)
    await startHarness();

    // Note: Environment variables are set by startHarness()

    // 4. Create Nest testing module
    this.moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // 5. Create Nest application
    // Disable Nest's default body parser to match production setup
    // This ensures webhook routes capture raw body before JSON parsing
    this.app = this.moduleRef.createNestApplication({
      bodyParser: false,
    });

    // 1) Webhooks: JSON parser with verify hook to capture raw bytes for signature verification
    // This MUST run before any other body parser to ensure verify hook fires
    this.app.use(
      '/webhooks',
      express.json({
        limit: '256kb',
        verify: (req: express.Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
          // Capture raw body bytes before JSON parsing
          req.rawBody = buf;
        },
      }),
    );

    // 2) Everything else: normal JSON parser (no raw capture needed)
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Apply global validation pipe (matching main.ts)
    this.app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await this.app.init();

    // 6. Get DataSource for migrations and cleanup
    this.dataSource = this.moduleRef.get<DataSource>(DataSource);

    // 7. Run migrations (if any exist)
    // Note: If synchronize is enabled (which it is in test env), migrations may fail
    // because tables already exist. That's okay - we'll skip migrations in that case.
    try {
      // Check if synchronize is enabled - if so, skip migrations
      const synchronize = this.dataSource.options.synchronize;
      if (!synchronize) {
        await this.dataSource.runMigrations();
      }
    } catch (error: any) {
      // If migrations fail because tables already exist (synchronize=true), that's expected
      // Otherwise, log the error but don't fail the test setup
      if (error?.code !== '42P07' && error?.code !== '42P16') {
        // 42P07 = relation already exists, 42P16 = invalid schema
        console.warn('Migration error (non-critical):', error.message);
      }
    }

    // 8. Get Redis client for cleanup
    try {
      this.redisClient = this.moduleRef.get<RedisClientType>('REDIS_CLIENT');
    } catch (error) {
      // Redis client might not be available, that's okay for now
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
    // Child tables first, then parents
    await this.dataSource.query('TRUNCATE TABLE identifier_mappings CASCADE');
    await this.dataSource.query('TRUNCATE TABLE sync_jobs CASCADE');
    await this.dataSource.query('TRUNCATE TABLE inventory_items CASCADE');
    await this.dataSource.query('TRUNCATE TABLE order_records CASCADE');
    // product_content_field FKs to both products + connections, so it goes before them.
    await this.dataSource.query('TRUNCATE TABLE product_content_field CASCADE');
    await this.dataSource.query('TRUNCATE TABLE product_variants CASCADE');
    await this.dataSource.query('TRUNCATE TABLE products CASCADE');
    await this.dataSource.query('TRUNCATE TABLE connections CASCADE');
    await this.dataSource.query('TRUNCATE TABLE users CASCADE');

    // Clear Redis cache
    if (this.redisClient) {
      try {
        await this.redisClient.flushDb();
      } catch (error) {
        // Redis might not be connected, that's okay
        console.warn('Failed to flush Redis:', error);
      }
    }
  }

  /**
   * Get Supertest HTTP client
   */
  getHttp(): ReturnType<typeof request> {
    if (!this.app) {
      throw new Error('Harness not initialized. Call setup() first.');
    }
    return request(this.app.getHttpServer());
  }

  /**
   * Get Nest application instance
   */
  getApp(): INestApplication {
    if (!this.app) {
      throw new Error('Harness not initialized. Call setup() first.');
    }
    return this.app;
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
   * Tear down test infrastructure
   *
   * Closes app, destroys DataSource, stops containers.
   */
  async teardown(): Promise<void> {
    // Close app first
    if (this.app) {
      try {
        await this.app.close();
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

    // Note: Containers are stopped by global teardown (harness.ts)
    // We don't stop them here to avoid importing AppModule in teardown
  }
}

// Global harness instance (shared across tests in same file)
let globalHarness: IntegrationTestHarness | null = null;

/**
 * Get or create global test harness
 *
 * Creates harness on first call, reuses on subsequent calls.
 */
export async function getTestHarness(): Promise<IntegrationTestHarness> {
  if (!globalHarness) {
    globalHarness = new IntegrationTestHarness();
    try {
      await globalHarness.setup();
    } catch (error) {
      globalHarness = null;
      throw error;
    }
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

