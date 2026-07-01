/**
 * Test Infrastructure Harness
 *
 * Manages testcontainers (Postgres + Redis) only. No Nest imports.
 * This is used by globalSetup/globalTeardown to avoid importing AppModule
 * which would trigger cross-app dependency resolution issues.
 *
 * @module apps/worker/test/integration
 */
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { StartedTestContainer } from 'testcontainers';
import { ciRunIdLabels } from '@openlinker/test-kit';

type Harness = {
  postgres: StartedPostgreSqlContainer;
  redis: StartedTestContainer;
};

let harness: Harness | undefined;

/**
 * Start test infrastructure (containers only)
 *
 * Starts Postgres and Redis containers and sets environment variables
 * for tests to use. Does NOT boot Nest application context.
 */
export async function startHarness(): Promise<void> {
  if (harness) {
    return; // Already started
  }

  // Start Postgres container
  const postgres = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('openlinker_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .withLabels(ciRunIdLabels())
    .start();

  // Start Redis container
  const redis = await new RedisContainer('redis:7-alpine').withLabels(ciRunIdLabels()).start();

  // Provide connection info to tests via env vars
  process.env.DB_HOST = postgres.getHost();
  process.env.DB_PORT = String(postgres.getPort());
  process.env.DB_USERNAME = 'postgres';
  process.env.DB_PASSWORD = 'postgres';
  process.env.DB_DATABASE = 'openlinker_test';
  process.env.REDIS_HOST = redis.getHost();
  process.env.REDIS_PORT = String(redis.getMappedPort(6379));
  process.env.REDIS_PASSWORD = '';
  process.env.REDIS_DB = '0';
  process.env.NODE_ENV = 'test';

  harness = { postgres, redis };
}

/**
 * Stop test infrastructure (containers only)
 *
 * Stops Postgres and Redis containers. Does NOT close Nest application context.
 */
export async function stopHarness(): Promise<void> {
  const h = harness;
  if (!h) {
    return; // Already stopped or never started
  }

  // Stop containers in parallel
  await Promise.allSettled([h.redis.stop(), h.postgres.stop()]);

  // Clear reference
  harness = undefined;
}

