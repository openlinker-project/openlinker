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
const DEFAULT_REDIS_IMAGE = 'valkey/valkey:8-alpine';
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
 * Env var flipped to `'true'` once this process has actually booted the
 * containers (never on the primed-reuse path below). A Jest `globalSetup`
 * hook runs in the main process realm; the per-suite lazy caller (e.g.
 * `IntegrationTestHarnessImpl.setup()`) runs inside a worker/VM realm with
 * its own `globalThis` — so the `__OL_TEST_KIT_CONTAINERS__` singleton check
 * above can't detect "already started elsewhere." `process.env`, unlike
 * `globalThis`, *is* inherited by the worker process Jest forks after
 * `globalSetup` completes, so this flag is the cross-realm signal.
 */
const CONTAINERS_PRIMED_ENV_VAR = 'OL_TEST_KIT_CONTAINERS_PRIMED';

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
 *
 * Cross-realm reuse: if a `globalSetup` hook already primed containers in
 * the Jest main process (see `CONTAINERS_PRIMED_ENV_VAR`), this call — made
 * from the worker realm — reuses the inherited `DB_*`/`REDIS_*` env vars
 * instead of booting a second Postgres/Redis pair. `config.env` is still
 * applied on this path so per-suite fixtures (JWT secrets, feature flags)
 * keep working.
 */
export async function startContainers(config?: ContainerConfig): Promise<ContainerHandles> {
  if (globalThis.__OL_TEST_KIT_CONTAINERS__) {
    applyEnvOverrides(config);
    return toHandles(globalThis.__OL_TEST_KIT_CONTAINERS__);
  }

  if (process.env[CONTAINERS_PRIMED_ENV_VAR] === 'true') {
    applyEnvOverrides(config);
    return handlesFromEnv();
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
  process.env[CONTAINERS_PRIMED_ENV_VAR] = 'true';

  applyEnvOverrides(config);

  globalThis.__OL_TEST_KIT_CONTAINERS__ = { postgres, redis };
  return toHandles(globalThis.__OL_TEST_KIT_CONTAINERS__);
}

function applyEnvOverrides(config?: ContainerConfig): void {
  if (config?.env) {
    for (const [key, value] of Object.entries(config.env)) {
      process.env[key] = value;
    }
  }
}

/**
 * Build `ContainerHandles` from already-set `DB_*`/`REDIS_*` env vars —
 * used on the primed-reuse path, where this realm never started its own
 * `StartedPostgreSqlContainer` / `StartedRedisContainer` instances to read
 * host/port off of.
 */
function handlesFromEnv(): ContainerHandles {
  return {
    postgres: {
      host: process.env.DB_HOST ?? '',
      port: Number(process.env.DB_PORT),
      database: process.env.DB_DATABASE ?? DEFAULT_DB_NAME,
      username: process.env.DB_USERNAME ?? DEFAULT_DB_USER,
      password: process.env.DB_PASSWORD ?? DEFAULT_DB_PASSWORD,
    },
    redis: {
      host: process.env.REDIS_HOST ?? '',
      port: Number(process.env.REDIS_PORT),
    },
  };
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

  // Testcontainers' underlying `@redis/client` socket can emit a stray
  // 'error' event (e.g. SocketClosedUnexpectedlyError) once the Redis
  // container is torn down — outside the Promise chain below, so .catch()
  // never sees it. Node's default behaviour for an EventEmitter 'error'
  // with no listener is to rethrow as an uncaught exception, which crashes
  // this whole globalTeardown process with a non-zero exit code even though
  // every test already passed (surfaced once stopContainers() started
  // actually running here — previously this was a no-op, see #1285). Swallow
  // it for the duration of the stop() calls only, so an unrelated crash
  // elsewhere in this short-lived teardown script is still fatal.
  const swallowTeardownSocketNoise = (err: unknown): void => {
    console.warn('test-kit: swallowed a post-teardown socket error:', err);
  };
  process.on('uncaughtException', swallowTeardownSocketNoise);

  try {
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
  } finally {
    process.off('uncaughtException', swallowTeardownSocketNoise);
  }

  globalThis.__OL_TEST_KIT_CONTAINERS__ = undefined;
  delete process.env[CONTAINERS_PRIMED_ENV_VAR];
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
