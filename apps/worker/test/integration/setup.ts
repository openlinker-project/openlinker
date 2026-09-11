/**
 * Worker Integration Test Harness
 *
 * Provides a reusable foundation for all worker integration tests. Manages Testcontainers
 * (Postgres + Redis), boots Nest application context (no HTTP server), runs migrations,
 * and provides utilities for test execution.
 *
 * `resetTestHarness()` below is called from every int-spec's own `afterEach` AND, since
 * #2999, from a root-level `beforeEach`/`afterEach` registered once via `setupFilesAfterEnv`
 * — see `setup-each.ts` for the audit of what that global reset is safe to do across every
 * worker int-spec, and `harness-isolation.int-spec.ts` for the regression guard.
 *
 * @module apps/worker/test/integration
 */
import { NestFactory } from '@nestjs/core';
import { INestApplicationContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RedisClientType } from 'redis';
// Test-only deep import, resolved by `jest-integration.cjs`'s
// `@openlinker/test-kit/*` -> `libs/test-kit/src/*` mapping. See `reset()`.
import { truncateTables } from '@openlinker/test-kit/harness';
import { MASTER_DELETION_EVENT_STREAM } from '@openlinker/core/products';
import { AppModule } from '../../src/app.module';
import { MASTER_DELETION_CONSUMER_GROUP } from '../../src/events/master-deletion-to-job.handler';

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

    // Create Nest application context (no HTTP server for worker). Boots the
    // full role set — the per-service enable gates (WORKER_RUNNER_ENABLED,
    // OL_SCHEDULER_ENABLED, …) keep background loops quiet under tests.
    this.appContext = await NestFactory.createApplicationContext(AppModule.forRoles(), {
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
   * Truncates the tables listed below and clears the Redis database, but only
   * the ones that actually hold state (#2999) — the pre-existing unconditional
   * 7-statement `TRUNCATE` chain plus `flushDb()` cost a fixed amount of
   * round-trip time on EVERY reset regardless of whether the previous test
   * dirtied anything, and since #2999 wires this into a `beforeEach`/
   * `afterEach` pair for every test case of every int-spec (`setup-each.ts`)
   * rather than an occasional per-file `afterEach`, that fixed cost is now
   * paid far more often.
   *
   * The probe is `truncateTables` from `@openlinker/test-kit/harness`, the
   * same helper the api suite reaches through `createIntegrationTestHarness`
   * — NOT a local copy of it (#3126 review). The difference is the one thing
   * a reimplementation gets wrong: `truncateTables` expands the caller's list
   * with its `pg_constraint` CASCADE closure before probing, so skipping an
   * EMPTY parent cannot leave a dependent's rows behind. Probing the literal
   * list alone silently drops the collateral an unconditional
   * `TRUNCATE <parent> CASCADE` used to clear, turning a guarantee into a
   * per-schema reasoning obligation over a ~100-table schema that grows while
   * only seven names are listed here. (An earlier revision of this file said
   * the helper was "intentionally not exported for reuse" — that was wrong.
   * It is exported from `harness.ts`, merely absent from the package barrel,
   * and `jest-integration.cjs` maps `@openlinker/test-kit/*` to `src/*`, so
   * this deep import is the sanctioned test-only one and resolves in exactly
   * this realm. `setup.ts` is never loaded from the `globalSetup` /
   * `globalTeardown` realms, where that mapping would not apply.)
   */
  async reset(): Promise<void> {
    if (!this.dataSource) {
      throw new Error('Harness not initialized. Call setup() first.');
    }

    // #2219's connection_cursors note still applies: the master sweeps persist
    // a resume cursor there, and without truncating it a spec inherits the
    // previous one's cursor and silently resumes mid-cycle.
    await truncateTables(this.dataSource, [
      'sync_jobs',
      'inventory_items',
      'product_variants',
      'products',
      'identifier_mappings',
      'connection_cursors',
      'connections',
    ]);

    // Clear Redis cache and streams — but only if there's anything to clear.
    // `DBSIZE` is an O(1) server-side counter (unlike `KEYS`/`SCAN`), so this
    // probe costs nothing material even on a database that never went empty.
    if (this.redisClient) {
      try {
        const size = await this.redisClient.dbSize();
        if (size > 0) {
          await this.redisClient.flushDb();
          await this.restoreMasterDeletionConsumerGroup();
        }
      } catch (error) {
        console.warn('Failed to flush Redis:', error);
      }
    }
  }

  /**
   * Put `events.master.deletion` and its consumer group back after a flush.
   *
   * `MasterDeletionToJobHandler` creates the group exactly ONCE, in
   * `onModuleInit` (`MKSTREAM: true`), and its `consumeLoop` catches every
   * read error, logs at ERROR level, sleeps 1 s and retries — it never
   * recreates the group. `OL_MASTER_DELETION_CONSUMER_ENABLED` is not forced
   * off by `harness.ts`, so that loop is live in every worker int-spec,
   * including the boot specs.
   *
   * Without this, the FIRST `flushDb()` destroys stream and group permanently
   * for the rest of the file's run and the loop emits an error line per
   * second — worst of all in the six boot specs, whose whole purpose is
   * diagnosing wiring (#3126 review). No assertion breaks
   * (`master-inventory-deletion-e2e` reads the stream with `xRange`, not
   * through the group), so this is diagnosability rather than correctness —
   * which is exactly why it would have been left to rot.
   *
   * Best-effort by design: a failure here must never fail a reset, and the
   * loop may still log one error if it happens to read in the window between
   * the flush and this call. One line is not one per second.
   */
  private async restoreMasterDeletionConsumerGroup(): Promise<void> {
    if (!this.redisClient) {
      return;
    }
    try {
      await this.redisClient.xGroupCreate(
        MASTER_DELETION_EVENT_STREAM,
        MASTER_DELETION_CONSUMER_GROUP,
        '$',
        { MKSTREAM: true }
      );
    } catch (error) {
      // BUSYGROUP means a peer recreated it first — the desired end state.
      if (!(error instanceof Error) || !error.message.includes('BUSYGROUP')) {
        console.warn('Failed to restore master-deletion consumer group:', error);
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

