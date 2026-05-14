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
  it('should issue TRUNCATE statements for caller-supplied tables in order, with no hardcoded names', async () => {
    // Regression guard: when the harness reset path runs, it must truncate
    // exactly what the caller asked for — not the 12 API-specific tables that
    // were hardcoded in apps/api before this refactor.
    const queries: string[] = [];
    const fakeDataSource = {
      query: (sql: string): Promise<void> => {
        queries.push(sql);
        return Promise.resolve();
      },
    };

    await truncateTables(fakeDataSource, ['plugin_table_alpha', 'plugin_table_beta']);

    expect(queries).toEqual([
      'TRUNCATE TABLE "plugin_table_alpha" CASCADE',
      'TRUNCATE TABLE "plugin_table_beta" CASCADE',
    ]);
  });

  it('should issue zero queries when the table list is empty', async () => {
    const queries: string[] = [];
    const fakeDataSource = {
      query: (sql: string): Promise<void> => {
        queries.push(sql);
        return Promise.resolve();
      },
    };

    await truncateTables(fakeDataSource, []);

    expect(queries).toEqual([]);
  });
});
