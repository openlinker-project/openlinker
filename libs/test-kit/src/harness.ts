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
 * Unquoted Postgres identifier shape.
 *
 * `truncateTables` interpolates table names into SQL (they are quoted, but
 * quoting alone does not stop a `"` in the name from closing the identifier).
 * Every in-tree caller passes hard-coded constants, but the helper is a
 * published seam plugin authors can reach, so names are asserted rather than
 * trusted.
 */
const UNQUOTED_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

/**
 * Per-DataSource memo of the cascade closure for a given table list.
 *
 * The FK graph cannot change while an int-spec runs (the schema is built once
 * by TypeORM `synchronize` at boot), so the `pg_constraint` walk is resolved on
 * the first reset and reused for every later one — keeping the steady-state
 * reset at the two round-trips it had before (probe + `TRUNCATE`).
 */
const cascadeClosureCache = new WeakMap<QueryRunner, Map<string, ReadonlyArray<string>>>();

function assertSafeTableNames(tables: ReadonlyArray<string>): void {
  for (const table of tables) {
    if (!UNQUOTED_IDENTIFIER.test(table)) {
      throw new Error(
        `test-kit: refusing to truncate "${table}" - table names must match ${String(UNQUOTED_IDENTIFIER)}`,
      );
    }
  }
}

/**
 * Expand the caller's list with every table that `TRUNCATE ... CASCADE` on it
 * would have cleared as collateral (transitively), so that skipping an *empty*
 * parent cannot leave a dependent's rows behind.
 *
 * Why this exists: the pre-#1920 code ran one `TRUNCATE <t> CASCADE` per listed
 * table, which also wipes every table holding an FK to `<t>` — including tables
 * the caller never listed. Probing only the literal list would drop that side
 * effect whenever the parent happens to be empty while a dependent still holds
 * rows (possible with a nullable FK), which is exactly how order-dependent
 * flakes are born. Probing the closure instead keeps the resulting state
 * identical to the old loop's.
 *
 * The caller's own names are always kept, even if Postgres reports no such
 * relation — a typo'd table must still fail loudly at probe time rather than
 * being silently dropped from the reset.
 *
 * Both terms of the walk are constrained to `current_schemas(false)`, the
 * recursive one included: the reset is scoped to the schema under test, and a
 * dependent living outside `search_path` is not something an int-spec's
 * `TRUNCATE` should reach into. Without the guard on the *dependent* side, a
 * cross-schema FK pulls an unreachable relation into the closure and the probe
 * — one `UNION ALL` statement — then fails with `relation "x" does not exist`,
 * taking every `afterEach` in the suite down with it (PR #1923 review).
 */
async function resolveCascadeClosure(
  dataSource: QueryRunner,
  tables: ReadonlyArray<string>,
): Promise<ReadonlyArray<string>> {
  const cacheKey = tables.join(',');
  const cached = cascadeClosureCache.get(dataSource)?.get(cacheKey);
  if (cached) {
    return cached;
  }

  const literals = tables.map((table) => `'${table}'`).join(', ');
  const rows = (await dataSource.query(
    'WITH RECURSIVE requested AS (' +
      ' SELECT c.oid FROM pg_class c' +
      ' JOIN pg_namespace n ON n.oid = c.relnamespace' +
      ` WHERE c.relname IN (${literals}) AND n.nspname = ANY (current_schemas(false))` +
      '), closure AS (' +
      ' SELECT oid FROM requested' +
      ' UNION' +
      ' SELECT con.conrelid FROM pg_constraint con' +
      ' JOIN closure ON con.confrelid = closure.oid' +
      ' JOIN pg_class dep ON dep.oid = con.conrelid' +
      ' JOIN pg_namespace depns ON depns.oid = dep.relnamespace' +
      " WHERE con.contype = 'f'" +
      ' AND depns.nspname = ANY (current_schemas(false))' +
      ') SELECT c.relname AS table_name FROM closure JOIN pg_class c ON c.oid = closure.oid',
  )) as ReadonlyArray<{ table_name: string }>;

  const dependents = rows
    .map((row) => row.table_name)
    .filter((name) => !tables.includes(name))
    .sort();
  assertSafeTableNames(dependents);

  const closure = dependents.length === 0 ? tables : [...tables, ...dependents];
  const perDataSource =
    cascadeClosureCache.get(dataSource) ?? new Map<string, ReadonlyArray<string>>();
  perDataSource.set(cacheKey, closure);
  cascadeClosureCache.set(dataSource, perDataSource);

  return closure;
}

/**
 * Truncate the tables that actually hold a row.
 *
 * `TRUNCATE` costs ~10 ms per table regardless of its contents (measured
 * against the test container: 1 table ~10 ms, 18 tables ~207 ms, 46 tables
 * ~390 ms - linear in the table count, flat in the row count). Because this
 * runs in `afterEach` of nearly every int-spec while a typical test dirties
 * two or three tables, truncating the whole list unconditionally spent most of
 * the time clearing tables that were already empty (#1920).
 *
 * One probe round-trip narrows the list, then a single `TRUNCATE` clears it -
 * ~207 ms down to ~13 ms per reset. A test that dirtied nothing issues no
 * `TRUNCATE` at all. Batching alone was measured and is NOT the win (18
 * statements 280 ms vs one combined statement 215 ms); skipping empty tables
 * is.
 *
 * The probed list is the caller's list expanded to its `CASCADE` closure (see
 * `resolveCascadeClosure`) so that skipping an empty table cannot silently drop
 * the collateral clear the old per-table `TRUNCATE ... CASCADE` performed. For
 * the apps/api list the closure is currently a no-op — the synchronize-built
 * test schema has exactly four FKs (`product_variants -> products`,
 * `inventory_items -> products`, `inventory_items -> product_variants`,
 * `attribute_value_mappings -> attribute_mappings`) and every dependent of a
 * listed table is itself listed — but the expansion means a future FK does not
 * have to be noticed by hand.
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
  if (tables.length === 0) {
    return;
  }

  assertSafeTableNames(tables);
  const candidates = await resolveCascadeClosure(dataSource, tables);

  const probe = candidates
    .map((table) => `SELECT '${table}' AS table_name WHERE EXISTS (SELECT 1 FROM "${table}")`)
    .join(' UNION ALL ');
  const dirty = (await dataSource.query(probe)) as ReadonlyArray<{ table_name: string }>;

  if (dirty.length === 0) {
    return;
  }

  const list = dirty.map((row) => `"${row.table_name}"`).join(', ');
  await dataSource.query(`TRUNCATE TABLE ${list} CASCADE`);
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

    // Run after pipes, before init — lets callers register the same global
    // exception filters their production bootstrap applies (the `main.ts`
    // filters are not otherwise wired into the int-test app).
    if (this.config.configureApp) {
      this.config.configureApp(this.app);
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
  // Cache the in-flight setup *promise*, not the instance — guarantees concurrent
  // first-callers share one boot, and a failed setup clears the slot so the next
  // call retries from scratch (no half-initialized instance latches).
  let instancePromise: Promise<IntegrationTestHarnessImpl> | null = null;

  async function getTestHarness(): Promise<IntegrationTestHarness> {
    if (!instancePromise) {
      const fresh = new IntegrationTestHarnessImpl(config);
      instancePromise = fresh
        .setup()
        .then(() => fresh)
        .catch((err: unknown) => {
          instancePromise = null;
          throw err;
        });
    }
    return instancePromise;
  }

  async function resetTestHarness(): Promise<void> {
    if (instancePromise) {
      const instance = await instancePromise;
      await instance.reset();
    }
  }

  async function teardownTestHarness(): Promise<void> {
    if (instancePromise) {
      const instance = await instancePromise;
      await instance.teardown();
      instancePromise = null;
    }
  }

  return { getTestHarness, resetTestHarness, teardownTestHarness };
}
