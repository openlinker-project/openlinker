/**
 * Test-Kit Factory Tests
 *
 * Unit tests for `createIntegrationTestHarness` + the `truncateTables` helper
 * that exercise the public-shape contract without booting real containers.
 * Real container behaviour is exercised by every consuming int-spec in
 * apps/api and (future) plugin packages.
 *
 * @module libs/test-kit
 */
import { createIntegrationTestHarness, truncateTables } from '../harness';

describe('createIntegrationTestHarness', () => {
  it('should return a TestHarnessHandle exposing the three singleton-accessor methods', () => {
    const handle = createIntegrationTestHarness({ imports: [] });

    expect(typeof handle.getTestHarness).toBe('function');
    expect(typeof handle.resetTestHarness).toBe('function');
    expect(typeof handle.teardownTestHarness).toBe('function');
  });

  it('should make resetTestHarness and teardownTestHarness no-ops before getTestHarness is called', async () => {
    const handle = createIntegrationTestHarness({
      imports: [],
      tablesToTruncate: ['users', 'connections'],
    });

    // No setup → no instance → both calls should resolve without throwing.
    await expect(handle.resetTestHarness()).resolves.toBeUndefined();
    await expect(handle.teardownTestHarness()).resolves.toBeUndefined();
  });
});

describe('truncateTables', () => {
  /**
   * Fake DataSource that records every statement and answers the two reads
   * `truncateTables` issues: the `pg_constraint` cascade-closure walk (answered
   * with `closure`, defaulting to "no dependents beyond the caller's list") and
   * the dirty-table probe (answered with `dirty`).
   */
  function makeFake(
    dirty: ReadonlyArray<string>,
    closure?: ReadonlyArray<string>,
  ): {
    fake: { query: (sql: string) => Promise<unknown> };
    queries: string[];
    probes: string[];
  } {
    const queries: string[] = [];
    const probes: string[] = [];
    const fake = {
      query: (sql: string): Promise<unknown> => {
        queries.push(sql);
        if (sql.includes('pg_constraint')) {
          return Promise.resolve((closure ?? []).map((table_name) => ({ table_name })));
        }
        if (sql.startsWith('SELECT')) {
          probes.push(sql);
          return Promise.resolve(dirty.map((table_name) => ({ table_name })));
        }
        return Promise.resolve([]);
      },
    };
    return { fake, queries, probes };
  }

  it('should truncate only the tables the probe reports as non-empty (#1920)', async () => {
    // TRUNCATE costs ~10 ms per table even when it is empty, so the reset path
    // must not clear tables the test never touched.
    const { fake, queries } = makeFake(['plugin_table_beta']);

    await truncateTables(fake, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(queries).toHaveLength(3);
    expect(queries[2]).toBe('TRUNCATE TABLE "plugin_table_beta" CASCADE');
    expect(queries[2]).not.toContain('plugin_table_alpha');
  });

  it('should probe exactly the caller-supplied tables, with no hardcoded names', async () => {
    // Regression guard: when the harness reset path runs, it must consider
    // exactly what the caller asked for - not the 12 API-specific tables that
    // were hardcoded in apps/api before this refactor.
    const { fake, probes } = makeFake([]);

    await truncateTables(fake, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(probes[0]).toBe(
      'SELECT \'plugin_table_alpha\' AS table_name WHERE EXISTS (SELECT 1 FROM "plugin_table_alpha")' +
        ' UNION ALL ' +
        'SELECT \'plugin_table_beta\' AS table_name WHERE EXISTS (SELECT 1 FROM "plugin_table_beta")',
    );
  });

  it('should issue no TRUNCATE at all when every table is already empty', async () => {
    const { fake, queries } = makeFake([]);

    await truncateTables(fake, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(queries).toHaveLength(2);
    expect(queries.some((sql) => sql.includes('TRUNCATE'))).toBe(false);
  });

  it('should truncate every table in one statement when all of them are dirty', async () => {
    const { fake, queries } = makeFake(['plugin_table_alpha', 'plugin_table_beta']);

    await truncateTables(fake, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(queries[2]).toBe('TRUNCATE TABLE "plugin_table_alpha", "plugin_table_beta" CASCADE');
  });

  it('should issue zero queries when the table list is empty', async () => {
    const { fake, queries } = makeFake([]);

    await truncateTables(fake, []);

    expect(queries).toEqual([]);
  });

  it('should probe tables that only CASCADE would have cleared, so an empty parent does not strand a dependent (#1923 review)', async () => {
    // The pre-#1920 loop ran `TRUNCATE <t> CASCADE` per table, which also wiped
    // every table holding an FK to <t> - even one the caller never listed.
    // Probing only the literal list would drop that whenever the parent is
    // empty while a dependent (nullable FK) still holds rows.
    const { fake, probes, queries } = makeFake(['child_table'], ['plugin_table_alpha', 'child_table']);

    await truncateTables(fake, ['plugin_table_alpha']);

    expect(probes[0]).toContain('child_table');
    expect(queries[2]).toBe('TRUNCATE TABLE "child_table" CASCADE');
  });

  it('should constrain the DEPENDENT side of the closure walk to the search path (#1923 review)', async () => {
    // A table in another schema holding an FK to a listed one would otherwise
    // enter the closure and then be probed by its bare name, failing every
    // afterEach in the suite with `relation "x" does not exist`. Asserted on
    // the emitted SQL because the schema guard IS the behaviour under test.
    const { fake, queries } = makeFake([]);

    await truncateTables(fake, ['plugin_table_alpha']);

    const walk = queries.find((sql) => sql.includes('pg_constraint'));
    expect(walk).toContain('depns.nspname = ANY (current_schemas(false))');
  });

  it('should resolve the cascade closure once per DataSource and reuse it', async () => {
    // The FK graph is fixed for the life of the schema, so the pg_constraint
    // walk must not add a round-trip to every afterEach.
    const { fake, queries } = makeFake([]);

    await truncateTables(fake, ['plugin_table_alpha']);
    await truncateTables(fake, ['plugin_table_alpha']);

    expect(queries.filter((sql) => sql.includes('pg_constraint'))).toHaveLength(1);
  });

  it('should reject a table name that is not a plain identifier', async () => {
    const { fake, queries } = makeFake([]);

    await expect(truncateTables(fake, ['users"; DROP TABLE users; --'])).rejects.toThrow(
      /refusing to truncate/,
    );
    expect(queries).toEqual([]);
  });
});
