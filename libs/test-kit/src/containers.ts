/**
 * Testcontainers Lifecycle
 *
 * Boots ephemeral Postgres and Redis containers for integration tests and
 * stores connection info in environment variables that downstream Nest apps
 * read at boot. Framework-neutral — no Nest, no AppModule imports — so this
 * can run from Jest `globalSetup` / `globalTeardown` without dragging in the
 * full DI graph.
 *
 * @module libs/test-kit
 */
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedRedisContainer } from '@testcontainers/redis';
import { RedisContainer } from '@testcontainers/redis';
import type { ContainerConfig, ContainerHandles } from './types';

interface HarnessState {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
}

declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`; let / const don't attach to globalThis at module scope
  var __OL_TEST_KIT_CONTAINERS__: HarnessState | undefined;
}

const DEFAULT_POSTGRES_IMAGE = 'postgres:16-alpine';
const DEFAULT_REDIS_IMAGE = 'redis:7-alpine';
const DEFAULT_DB_NAME = 'openlinker_test';
const DEFAULT_DB_USER = 'postgres';
const DEFAULT_DB_PASSWORD = 'postgres';

/**
 * Docker label key carrying the owning CI run's id.
 *
 * CI's orphan-sweep step (#1285) reads this label to ask the GitHub Actions
 * API whether the run that created a given container has actually finished,
 * rather than guessing from container age — the precise check can never
 * mistake a live, concurrently-running job's container for an orphan.
 */
export const CI_RUN_ID_LABEL = 'ol.ci.run-id';

/**
 * Label set every Testcontainers-backed container/helper should stamp on
 * itself. `GITHUB_RUN_ID` is only set inside GitHub Actions; local/dev runs
 * fall back to `'local'`, which the CI sweep step never touches.
 */
export function ciRunIdLabels(): Record<string, string> {
  return { [CI_RUN_ID_LABEL]: process.env.GITHUB_RUN_ID ?? 'local' };
}

/**
 * Start Postgres + Redis containers and populate connection env vars.
 *
 * Idempotent — a second call returns the existing handles without booting
 * new containers. Backed by a `globalThis` singleton so it survives Jest's
 * module-graph isolation between test files in the same worker.
 *
 * Sets these env vars on success:
 * - `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`
 * - `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (empty), `REDIS_DB` (`'0'`)
 *
 * Plus anything in `config.env` (set last, so callers can override the
 * defaults above if they really mean to).
 */
export async function startContainers(config?: ContainerConfig): Promise<ContainerHandles> {
  if (globalThis.__OL_TEST_KIT_CONTAINERS__) {
    return toHandles(globalThis.__OL_TEST_KIT_CONTAINERS__);
  }

  const postgres = await new PostgreSqlContainer(config?.postgresImage ?? DEFAULT_POSTGRES_IMAGE)
    .withDatabase(DEFAULT_DB_NAME)
    .withUsername(DEFAULT_DB_USER)
    .withPassword(DEFAULT_DB_PASSWORD)
    .withLabels(ciRunIdLabels())
    .start();

  const redis = await new RedisContainer(config?.redisImage ?? DEFAULT_REDIS_IMAGE)
    .withLabels(ciRunIdLabels())
    .start();

  process.env.DB_HOST = postgres.getHost();
  process.env.DB_PORT = String(postgres.getPort());
  process.env.DB_USERNAME = DEFAULT_DB_USER;
  process.env.DB_PASSWORD = DEFAULT_DB_PASSWORD;
  process.env.DB_DATABASE = DEFAULT_DB_NAME;
  process.env.REDIS_HOST = redis.getHost();
  process.env.REDIS_PORT = String(redis.getPort());
  process.env.REDIS_PASSWORD = '';
  process.env.REDIS_DB = '0';

  if (config?.env) {
    for (const [key, value] of Object.entries(config.env)) {
      process.env[key] = value;
    }
  }

  globalThis.__OL_TEST_KIT_CONTAINERS__ = { postgres, redis };
  return toHandles(globalThis.__OL_TEST_KIT_CONTAINERS__);
}

/**
 * Stop the Postgres + Redis containers and clear the global state.
 *
 * Idempotent. Failures during stop are logged but do not throw — Jest
 * teardown should be best-effort.
 */
export async function stopContainers(): Promise<void> {
  const state = globalThis.__OL_TEST_KIT_CONTAINERS__;
  if (!state) {
    return;
  }

  await Promise.allSettled([
    state.redis.stop().catch((err: unknown) => {
      // Test-time teardown; using console.warn rather than the Logger factory.
      // Logger backend may already be torn down at this point — see plan § 4.
      console.warn('test-kit: failed to stop Redis container:', err);
    }),
    state.postgres.stop().catch((err: unknown) => {
      console.warn('test-kit: failed to stop Postgres container:', err);
    }),
  ]);

  globalThis.__OL_TEST_KIT_CONTAINERS__ = undefined;
}

function toHandles(state: HarnessState): ContainerHandles {
  return {
    postgres: {
      host: state.postgres.getHost(),
      port: state.postgres.getPort(),
      database: DEFAULT_DB_NAME,
      username: DEFAULT_DB_USER,
      password: DEFAULT_DB_PASSWORD,
    },
    redis: {
      host: state.redis.getHost(),
      port: state.redis.getPort(),
    },
  };
}
