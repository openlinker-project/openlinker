/**
 * Test-Kit Public Types
 *
 * Configuration and handle types for the integration-test harness factory.
 * Consumed by `createIntegrationTestHarness(config)` and re-exported from the
 * package barrel for plugin authors and host apps.
 *
 * @module libs/test-kit
 */
import type { INestApplication, ModuleMetadata, ValidationPipeOptions } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { RedisClientType } from 'redis';
import type supertest from 'supertest';

/**
 * Configuration accepted by `createIntegrationTestHarness`.
 *
 * Caller-supplied — apps/api and plugin authors each populate this with
 * their own Nest module, table list, body-parser hook, and env-var fixtures.
 * All fields except `imports` are optional and have safe defaults.
 */
export interface IntegrationTestHarnessConfig {
  /**
   * Nest modules to register in the test app.
   *
   * The factory passes these into `Test.createTestingModule({ imports })`.
   * Replaces today's hardcoded `AppModule` import in apps/api.
   */
  imports: NonNullable<ModuleMetadata['imports']>;

  /**
   * Optional `ValidationPipe` configuration.
   *
   * `undefined` (default): applies the apps/api production preset
   * (`whitelist + forbidNonWhitelisted + transform`).
   * `false`: disables the global pipe entirely.
   * Object: passed verbatim into `new ValidationPipe(options)`.
   */
  validationPipe?: ValidationPipeOptions | false;

  /**
   * Optional body-parser configuration hook.
   *
   * Receives the `INestApplication` so callers can wire any middleware they
   * need — today, apps/api uses this to install raw-body capture on
   * `/webhooks` for signature verification, and a default `express.json` on
   * everything else.
   *
   * If omitted, the factory installs a single `express.json({ limit: '1mb' })`
   * + `express.urlencoded({ extended: true })` — the minimum a Nest app
   * needs to handle JSON request bodies.
   */
  configureBodyParser?: (app: INestApplication) => void;

  /**
   * Optional app-configuration hook, run after body-parser + validation-pipe
   * setup and immediately before `app.init()`. Receives the `INestApplication`
   * so callers can register the same global exception filters / interceptors
   * their production bootstrap applies — without this, the filters wired in
   * `main.ts` (`app.useGlobalFilters(...)`) are NOT applied to the int-test app,
   * so domain exceptions surface as 500 instead of their mapped status.
   */
  configureApp?: (app: INestApplication) => void;

  /**
   * Tables to TRUNCATE between tests, in foreign-key-aware order.
   *
   * Caller-owned. apps/api lists its 12 canonical tables; plugin authors
   * list only the tables their adapter writes. Truncation is issued as
   * `TRUNCATE TABLE "<name>" CASCADE` against the test DataSource.
   *
   * If omitted, `reset()` is a no-op for the DB side (Redis is still flushed).
   */
  tablesToTruncate?: ReadonlyArray<string>;

  /**
   * Extra environment variables to set before container startup.
   *
   * Used for app-specific feature flags that must be in place before the
   * Nest app boots — e.g. apps/api sets `OL_BOOTSTRAP_ADMIN_ENABLED=false`,
   * `OL_AI_PROVIDER=fake`, scheduler-disable flags, JWT secrets.
   *
   * `DB_*` and `REDIS_*` are set by the container layer and ignored here.
   */
  env?: Readonly<Record<string, string>>;

  /**
   * DI token used to resolve the Redis client from the Nest container.
   *
   * Defaults to the string `'REDIS_CLIENT'` (apps/api's convention).
   * Pass `false` to skip Redis-client resolution entirely if the test app
   * doesn't bind one.
   */
  redisClientToken?: string | symbol | false;
}

/**
 * The harness instance returned from `getTestHarness()`.
 *
 * Exported as a type-only interface so consumers can type their locals
 * (`let harness: IntegrationTestHarness`) without being able to construct
 * the implementing class directly.
 */
export interface IntegrationTestHarness {
  setup(): Promise<void>;
  reset(): Promise<void>;
  teardown(): Promise<void>;
  getHttp(): ReturnType<typeof supertest>;
  getApp(): INestApplication;
  getDataSource(): DataSource;
  getRedisClient(): RedisClientType | undefined;
}

/**
 * Public surface returned by `createIntegrationTestHarness(config)`.
 *
 * The three singleton-accessor functions are the seam apps/api re-exports
 * to keep existing int-specs untouched. Each call to `createIntegrationTestHarness`
 * creates one lazily-initialized singleton.
 */
export interface TestHarnessHandle {
  /**
   * Lazy singleton accessor.
   *
   * Boots containers + Nest app on first call, returns the same instance
   * on subsequent calls. Throws on container/boot failures.
   */
  getTestHarness(): Promise<IntegrationTestHarness>;

  /**
   * Clear DB tables (per `config.tablesToTruncate`) and flush Redis.
   *
   * No-op if `getTestHarness()` was never called for this handle.
   */
  resetTestHarness(): Promise<void>;

  /**
   * Close the Nest app, destroy the DataSource, and close the Redis client.
   *
   * Containers are stopped by the global teardown path (`stopContainers`),
   * NOT here, to avoid coupling per-suite teardown to global lifecycle.
   *
   * No-op if `getTestHarness()` was never called for this handle.
   */
  teardownTestHarness(): Promise<void>;
}

/**
 * Container handles returned by `startContainers`.
 *
 * Surfaced for callers that need to introspect host/port/connection info
 * beyond the standard `DB_*` / `REDIS_*` env vars (rare — most consumers
 * read those vars).
 */
export interface ContainerHandles {
  postgres: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
  };
}

/**
 * Configuration for `startContainers`.
 */
export interface ContainerConfig {
  /**
   * Postgres image tag. Defaults to `postgres:16-alpine`.
   */
  postgresImage?: string;

  /**
   * Redis image tag. Defaults to `redis:7-alpine`.
   */
  redisImage?: string;

  /**
   * Extra environment variables to set after container startup but before
   * the caller boots its Nest app. Same shape as `IntegrationTestHarnessConfig.env`.
   */
  env?: Readonly<Record<string, string>>;
}
