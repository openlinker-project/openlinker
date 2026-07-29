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
   * Fake DataSource that records every statement and answers the dirty-table
   * probe with `dirty` - the tables it should report as holding a row.
   */
  function makeFake(dirty: ReadonlyArray<string>): {
    fake: { query: (sql: string) => Promise<unknown> };
    queries: string[];
  } {
    const queries: string[] = [];
    const fake = {
      query: (sql: string): Promise<unknown> => {
        queries.push(sql);
        return Promise.resolve(
          sql.startsWith('SELECT') ? dirty.map((table_name) => ({ table_name })) : [],
        );
      },
    };
    return { fake, queries };
  }

  it('should truncate only the tables the probe reports as non-empty (#1920)', async () => {
    // TRUNCATE costs ~10 ms per table even when it is empty, so the reset path
    // must not clear tables the test never touched.
    const { fake, queries } = makeFake(['plugin_table_beta']);

    await truncateTables(fake, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(queries).toHaveLength(2);
    expect(queries[1]).toBe('TRUNCATE TABLE "plugin_table_beta" CASCADE');
    expect(queries[1]).not.toContain('plugin_table_alpha');
  });

  it('should probe exactly the caller-supplied tables, with no hardcoded names', async () => {
    // Regression guard: when the harness reset path runs, it must consider
    // exactly what the caller asked for - not the 12 API-specific tables that
    // were hardcoded in apps/api before this refactor.
    const { fake, queries } = makeFake([]);

    await truncateTables(fake, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(queries[0]).toBe(
      'SELECT \'plugin_table_alpha\' AS table_name WHERE EXISTS (SELECT 1 FROM "plugin_table_alpha")' +
        ' UNION ALL ' +
        'SELECT \'plugin_table_beta\' AS table_name WHERE EXISTS (SELECT 1 FROM "plugin_table_beta")',
    );
  });

  it('should issue no TRUNCATE at all when every table is already empty', async () => {
    const { fake, queries } = makeFake([]);

    await truncateTables(fake, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(queries).toHaveLength(1);
    expect(queries.some((sql) => sql.includes('TRUNCATE'))).toBe(false);
  });

  it('should truncate every table in one statement when all of them are dirty', async () => {
    const { fake, queries } = makeFake(['plugin_table_alpha', 'plugin_table_beta']);

    await truncateTables(fake, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(queries[1]).toBe(
      'TRUNCATE TABLE "plugin_table_alpha", "plugin_table_beta" CASCADE',
    );
  });

  it('should issue zero queries when the table list is empty', async () => {
    const { fake, queries } = makeFake([]);

    await truncateTables(fake, []);

    expect(queries).toEqual([]);
  });
});
