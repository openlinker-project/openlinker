/**
 * Integration Test Harness Factory
 *
 * Provides `createIntegrationTestHarness(config)` — the public seam that host
 * apps (apps/api) and plugin authors call once per int-spec module to get a
 * lazy singleton Nest app + DataSource + Redis client backed by ephemeral
 * Testcontainers (see ./containers.ts).
 *
 * The internal `IntegrationTestHarnessImpl` class is NOT exported as a value;
 * callers consume it through the `TestHarnessHandle` returned by the factory
 * so they can't drift away from the singleton-accessor shape that the existing
 * 23 apps/api int-specs depend on.
 *
 * @module libs/test-kit
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import type { RedisClientType } from 'redis';
import supertest from 'supertest';
import express from 'express';
import { startContainers } from './containers';
import type {
  IntegrationTestHarness,
  IntegrationTestHarnessConfig,
  TestHarnessHandle,
} from './types';

const DEFAULT_REDIS_CLIENT_TOKEN = 'REDIS_CLIENT';

const DEFAULT_VALIDATION_PIPE_OPTIONS = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
} as const;

/**
 * Minimal contract `truncateTables` calls on the DataSource.
 *
 * Structural shape — broader than `Pick<DataSource, 'query'>` because the
 * real `DataSource.query` is generic (`<T>(...)Promise<T>`) and we need to
 * accept simpler fakes (`(sql: string) => Promise<void>`) for unit tests.
 */
export interface QueryRunner {
  query(sql: string): Promise<unknown>;
}

/**
 * Truncate the given tables in order against the DataSource.
 *
 * Extracted for testability — keeps the caller-supplied-table semantic
 * unit-testable without standing up Postgres. Each table is quoted
 * (`"<name>"`) to match Postgres' identifier rules; the test must pass
 * the bare table name without quotes.
 *
 * Exported for the test-kit's own spec only — not re-exported from the
 * package barrel.
 */
export async function truncateTables(
  dataSource: QueryRunner,
  tables: ReadonlyArray<string>,
): Promise<void> {
  for (const table of tables) {
    await dataSource.query(`TRUNCATE TABLE "${table}" CASCADE`);
  }
}

/**
 * Internal class — not exported. Consumers receive `TestHarnessHandle`
 * from the factory below.
 *
 * Visible export marker: kept `Impl` suffix so the type-only
 * `IntegrationTestHarness` interface keeps the clean name in IDE tooltips
 * for consumers.
 */
class IntegrationTestHarnessImpl implements IntegrationTestHarness {
  private app?: INestApplication;
  private dataSource?: DataSource;
  private redisClient?: RedisClientType;
  private moduleRef?: TestingModule;

  constructor(private readonly config: IntegrationTestHarnessConfig) {}

  async setup(): Promise<void> {
    await startContainers({ env: this.config.env });

    this.moduleRef = await Test.createTestingModule({
      imports: this.config.imports,
    }).compile();

    this.app = this.moduleRef.createNestApplication({
      // Disable Nest's default body parser so the caller's
      // `configureBodyParser` hook can install raw-body middleware
      // before any JSON parsing runs (apps/api needs this for `/webhooks`).
      bodyParser: false,
    });

    if (this.config.configureBodyParser) {
      this.config.configureBodyParser(this.app);
    } else {
      this.app.use(express.json({ limit: '1mb' }));
      this.app.use(express.urlencoded({ extended: true }));
    }

    if (this.config.validationPipe !== false) {
      const pipeOptions = this.config.validationPipe ?? DEFAULT_VALIDATION_PIPE_OPTIONS;
      this.app.useGlobalPipes(new ValidationPipe(pipeOptions));
    }

    await this.app.init();

    // Resolve DataSource — required for `reset()` to issue truncates.
    // Resolved with `strict: false` so it traverses the global DI scope and
    // finds the DataSource regardless of which feature module bound it.
    // If a consumer's Nest app does not provide a DataSource, they must
    // omit `tablesToTruncate` (in which case the DB-side reset is a no-op).
    try {
      this.dataSource = this.moduleRef.get<DataSource>(DataSource, { strict: false });
    } catch {
      // No DataSource bound — leave undefined; reset() will throw if
      // tablesToTruncate is configured without one.
    }

    if (this.config.redisClientToken !== false) {
      const redisToken = this.config.redisClientToken ?? DEFAULT_REDIS_CLIENT_TOKEN;
      try {
        this.redisClient = this.moduleRef.get<RedisClientType>(redisToken, { strict: false });
      } catch (error) {
        // Redis client not bound — fine, leave undefined. Test-time teardown
        // code; see plan § 4 for why this stays as console.warn.
        console.warn('test-kit: Redis client not available:', error);
      }
    }
  }

  async reset(): Promise<void> {
    if (this.config.tablesToTruncate && this.config.tablesToTruncate.length > 0) {
      if (!this.dataSource) {
        throw new Error(
          'test-kit: cannot reset tables — DataSource not initialized. Call setup() first.',
        );
      }
      await truncateTables(this.dataSource, this.config.tablesToTruncate);
    }

    if (this.redisClient) {
      try {
        await this.redisClient.flushDb();
      } catch (error) {
        // Best-effort teardown; see plan § 4.
        console.warn('test-kit: failed to flush Redis:', error);
      }
    }
  }

  getHttp(): ReturnType<typeof supertest> {
    if (!this.app) {
      throw new Error('test-kit: harness not initialized. Call setup() first.');
    }
    // `INestApplication.getHttpServer()` is typed `any` in Nest 10. Supertest
    // accepts any http.Server/Application/RequestListener at runtime, but the
    // structural cast through `unknown` is needed to satisfy
    // `@typescript-eslint/no-unsafe-argument`.
    const server = this.app.getHttpServer() as unknown as Parameters<typeof supertest>[0];
    return supertest(server);
  }

  getApp(): INestApplication {
    if (!this.app) {
      throw new Error('test-kit: harness not initialized. Call setup() first.');
    }
    return this.app;
  }

  getDataSource(): DataSource {
    if (!this.dataSource) {
      throw new Error(
        'test-kit: DataSource not initialized. Either setup() was not called, or the test app does not provide a DataSource.',
      );
    }
    return this.dataSource;
  }

  getRedisClient(): RedisClientType | undefined {
    return this.redisClient;
  }

  async teardown(): Promise<void> {
    if (this.app) {
      try {
        await this.app.close();
      } catch {
        // Ignore — best-effort teardown.
      }
    }

    if (this.dataSource && this.dataSource.isInitialized) {
      try {
        await this.dataSource.destroy();
      } catch {
        // Ignore — best-effort teardown.
      }
    }

    if (this.redisClient) {
      try {
        await this.redisClient.quit();
      } catch {
        // Ignore — best-effort teardown.
      }
    }

    // Containers are stopped by the global teardown path (`stopContainers`)
    // so suite-scoped teardown can keep the containers warm for the next
    // int-spec in the same Jest worker.
  }
}

/**
 * Factory: create a singleton test-harness handle.
 *
 * Each call returns an independent handle. Within a single handle, the
 * underlying `IntegrationTestHarnessImpl` is constructed once and reused
 * across `getTestHarness()` calls. Typical usage:
 *
 * ```typescript
 * // apps/api/test/integration/setup.ts
 * import { createIntegrationTestHarness } from '@openlinker/test-kit';
 * import { AppModule } from '../../src/app.module';
 *
 * const harness = createIntegrationTestHarness({
 *   imports: [AppModule],
 *   tablesToTruncate: ['users', 'connections', ...],
 *   env: { OL_AI_PROVIDER: 'fake' },
 *   configureBodyParser: (app) => { ... },
 * });
 *
 * export const { getTestHarness, resetTestHarness, teardownTestHarness } = harness;
 * ```
 */
export function createIntegrationTestHarness(
  config: IntegrationTestHarnessConfig,
): TestHarnessHandle {
  let instance: IntegrationTestHarnessImpl | null = null;

  async function getTestHarness(): Promise<IntegrationTestHarness> {
    if (!instance) {
      const fresh = new IntegrationTestHarnessImpl(config);
      try {
        await fresh.setup();
      } catch (error) {
        // Don't latch a half-initialized instance — let the next call retry.
        throw error;
      }
      instance = fresh;
    }
    return instance;
  }

  async function resetTestHarness(): Promise<void> {
    if (instance) {
      await instance.reset();
    }
  }

  async function teardownTestHarness(): Promise<void> {
    if (instance) {
      await instance.teardown();
      instance = null;
    }
  }

  return { getTestHarness, resetTestHarness, teardownTestHarness };
}
