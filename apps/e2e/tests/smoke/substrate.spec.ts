/**
 * Smoke: substrate proof
 *
 * Proves the E2E foundation works end-to-end against a running stack: the node
 * API client authenticates and reads health, the world resolves connections,
 * and the browser session (via storageState + per-test refresh) renders the
 * authenticated Connections page. Read-only — safe to run against a shared stack.
 *
 * @module tests/smoke
 */
import { test, expect } from '../../src/fixtures/test';

test.describe('substrate', () => {
  test('API reports healthy liveness', async ({ api }) => {
    const health = await api.health.liveness();
    expect(health.status).toBe('ok');
  });

  test('node API client authenticates via bearer login', async ({ api }) => {
    expect(api.isAuthenticated).toBe(true);
  });

  test('world resolves at least one connection from the API', async ({ world }) => {
    expect(world.connections.length).toBeGreaterThan(0);
  });

  test('connections page renders and matches the API list', async ({ api, pages }) => {
    const connections = await api.connections.list();
    test.skip(connections.length === 0, 'stack has no connections to display');

    await pages.connectionsList.goto();
    await expect(pages.connectionsList.table).toBeVisible();

    // Cross-check: the first connection from the API is present in the UI table.
    const first = connections[0];
    await expect(pages.connectionsList.row(first.name).first()).toBeVisible();
  });
});
