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
  // The harness boots the full role set (`AppModule.forRoles()` default) so
  // handler/DI specs see the complete graph, but the scheduler must not start
  // real cron timers under tests — opt this process out of the lease (#2279).
  process.env.OL_SCHEDULER_ENABLED = 'false';
  // Same reasoning for the job runner, and it is load-bearing rather than
  // tidy: `SyncJobRunner` defaults this gate to `'true'` when unset, and
  // nothing in `jest-integration.cjs` ever set it to `'false'` — a stale,
  // unreferenced `apps/worker/test/jest-global-setup.cjs` used to claim it
  // did, but grepping the repo showed nothing wired it in (removed in
  // #2825/#2828). So the real runner polled `sync_jobs` in Postgres about
  // once a second for the whole integration run and could claim a `queued`
  // row a suite had just inserted and was about to drive by hand, executing
  // the same job twice from two directions. No worker int-spec relies on the
  // background loop: every one drives handlers via `handler.execute(...)`,
  // or the runner's own methods directly, so the gate is set here for the
  // whole harness (#2825).
  process.env.WORKER_RUNNER_ENABLED = 'false';
  // `JobIntakeConsumer` defaults `WORKER_INTAKE_ENABLED` to `'true'` too and
  // was left running by the same gap above — it polls the `jobs.sync` Redis
  // stream for the whole integration run, the identical structural race one
  // loop over. No int-spec starts it or depends on it being started
  // (`job-intake-execution.int-spec.ts` drives the consumer directly rather
  // than relying on the background loop), so it is disabled here too rather
  // than left as an unaudited exception (#2828 review).
  process.env.WORKER_INTAKE_ENABLED = 'false';

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

