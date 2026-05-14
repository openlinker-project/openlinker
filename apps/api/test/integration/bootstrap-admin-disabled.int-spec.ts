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
import { getTestHarness, IntegrationTestHarness, teardownTestHarness } from './setup';

describe('Bootstrap admin disabled in integration harness (#278)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    // Force a fresh app boot so this assertion observes the real
    // post-`onApplicationBootstrap` state. Any cached harness from a
    // prior suite would mask a re-enabled bootstrap because app.init()
    // (and therefore the bootstrap hook) only runs once per harness.
    await teardownTestHarness();
    harness = await getTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('does not seed a default admin user after app boot', async () => {
    const rows = await harness
      .getDataSource()
      .query<
        { count: string }[]
      >(`SELECT COUNT(*)::text AS count FROM users WHERE username = 'admin'`);
    expect(rows[0].count).toBe('0');
  });
});
