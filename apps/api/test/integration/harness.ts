/**
 * Integration Test Harness - Container Management Only
 *
 * Manages Testcontainers (Postgres + Redis) without importing Nest app modules.
 * This prevents teardown from requiring @openlinker/core dist files.
 *
 * @module apps/api/test/integration
 */
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

/**
 * Harness state stored on globalThis
 */
interface HarnessState {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
}

declare global {
  // eslint-disable-next-line no-var
  var __API_TEST_HARNESS__: HarnessState | undefined;
}

/**
 * Start test containers
 *
 * Creates Postgres and Redis containers and stores connection info in env vars.
 * Idempotent - can be called multiple times safely.
 */
export async function startHarness(): Promise<void> {
  if (globalThis.__API_TEST_HARNESS__) {
    return; // Already started
  }

  // 1. Start Postgres container
  const postgres = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('openlinker_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  // 2. Start Redis container
  const redis = await new RedisContainer('redis:7-alpine').start();

  // 3. Set environment variables with container connection info
  process.env.DB_HOST = postgres.getHost();
  process.env.DB_PORT = String(postgres.getPort());
  process.env.DB_USERNAME = 'postgres';
  process.env.DB_PASSWORD = 'postgres';
  process.env.DB_DATABASE = 'openlinker_test';
  process.env.REDIS_HOST = redis.getHost();
  process.env.REDIS_PORT = String(redis.getPort());
  process.env.REDIS_PASSWORD = '';
  process.env.REDIS_DB = '0';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-for-integration-tests';
  process.env.JWT_EXPIRES_IN = '1d';

  // Disable all background schedulers in integration tests.
  // Cron jobs fire against an empty database and keep the Node.js event loop
  // alive, causing Jest to hang after tests complete.
  //
  // If a future integration test needs to exercise scheduler behaviour, register
  // the task via SchedulerService.registerTask() and then call scheduleTask()
  // directly (or re-invoke onModuleInit()) — the env vars below will have already
  // been evaluated by onModuleInit at boot, so they cannot be overridden mid-test.
  process.env.OL_ALLEGRO_POLL_SCHEDULER_ENABLED = 'false';
  process.env.OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED = 'false';
  process.env.OL_INVENTORY_SYNC_ENABLED = 'false';
  process.env.OL_PRODUCT_SYNC_ENABLED = 'false';

  // Store containers on globalThis for teardown
  globalThis.__API_TEST_HARNESS__ = { postgres, redis };
}

/**
 * Stop test containers
 *
 * Stops Postgres and Redis containers and cleans up global state.
 * Idempotent - can be called multiple times safely.
 */
export async function stopHarness(): Promise<void> {
  const harness = globalThis.__API_TEST_HARNESS__;
  if (!harness) {
    return; // Already stopped or never started
  }

  // Stop containers in parallel
  await Promise.allSettled([
    harness.redis.stop().catch((err) => {
      console.warn('Failed to stop Redis container:', err);
    }),
    harness.postgres.stop().catch((err) => {
      console.warn('Failed to stop Postgres container:', err);
    }),
  ]);

  // Clear global state
  globalThis.__API_TEST_HARNESS__ = undefined;
}



