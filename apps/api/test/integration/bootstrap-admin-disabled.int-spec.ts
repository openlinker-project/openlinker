/**
 * Bootstrap-admin-disabled regression guard (#278)
 *
 * Verifies that BootstrapAdminService does not seed a default `admin` user
 * when the integration harness boots. The harness sets
 * `OL_BOOTSTRAP_ADMIN_ENABLED=false` so `loginAsAdmin('admin')` in any suite
 * can freely insert its own admin row without colliding on the
 * `users.username` unique constraint. Without this guarantee, the first test
 * of every suite that calls `loginAsAdmin` fails at boot.
 *
 * If someone re-enables the bootstrap in `harness.ts` or adds a new seeding
 * `OnApplicationBootstrap`, this spec fails loudly.
 *
 * @module apps/api/test/integration
 */
import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

describe('Bootstrap admin disabled in integration harness (#278)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('leaves the users table empty after app boot', async () => {
    const result = await harness
      .getDataSource()
      .query<{ count: string }[]>('SELECT COUNT(*)::text AS count FROM users');
    expect(result[0].count).toBe('0');
  });
});
